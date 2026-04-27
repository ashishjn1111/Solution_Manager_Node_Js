const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getLLM, getEmbeddings } = require('./llm');
const { logStep } = require('../utils/helpers');

let vectorStore = null;
let combineChain = null;
let webChain = null;

// ───────────────────────────────────────
//  Document Loaders
// ───────────────────────────────────────

async function loadDocuments() {
  const { Document } = require('@langchain/core/documents');
  const documents = [];

  if (!fs.existsSync(config.DATA_DIR)) return documents;

  const files = fs.readdirSync(config.DATA_DIR);
  for (const filename of files) {
    const filePath = path.join(config.DATA_DIR, filename);
    if (!fs.statSync(filePath).isFile()) continue;
    if (filename.startsWith('chat_export_') || filename.startsWith('.')) continue;

    const ext = filename.split('.').pop().toLowerCase();

    try {
      let content = '';

      if (ext === 'pdf') {
        const pdfParse = require('pdf-parse');
        const buffer = fs.readFileSync(filePath);
        const data = await pdfParse(buffer);
        content = data.text;
      } else if (['txt', 'csv', 'md', 'html', 'json'].includes(ext)) {
        content = fs.readFileSync(filePath, 'utf-8');
      } else if (['doc', 'docx'].includes(ext)) {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ path: filePath });
        content = result.value;
      } else if (ext === 'xlsx') {
        const ExcelJS = require('exceljs');
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(filePath);
        const parts = [];
        wb.worksheets.forEach(sheet => {
          parts.push(`Sheet: ${sheet.name}`);
          sheet.eachRow(row => {
            parts.push(row.values.slice(1).map(v => v ?? '').join(', '));
          });
          parts.push('');
        });
        content = parts.join('\n');
      } else {
        continue; // unsupported for RAG loading
      }

      if (content.trim()) {
        documents.push(new Document({
          pageContent: content,
          metadata: { source: filename, page: 1 },
        }));
      }
    } catch (err) {
      console.error(`Load error ${filename}: ${err.message}`);
    }
  }

  return documents;
}

// ───────────────────────────────────────
//  RAG Index
// ───────────────────────────────────────

async function refreshRag() {
  const llm = getLLM();
  const embeddings = getEmbeddings();

  if (!llm || !embeddings) {
    vectorStore = combineChain = webChain = null;
    return;
  }

  const { ChatPromptTemplate } = require('@langchain/core/prompts');
  const { StringOutputParser } = require('@langchain/core/output_parsers');
  const { MemoryVectorStore } = require('langchain/vectorstores/memory');
  const { RecursiveCharacterTextSplitter } = require('@langchain/textsplitters');
  const { createStuffDocumentsChain } = require('langchain/chains/combine_documents');

  // Web chain (LLM-only synthesis)
  const webPrompt = ChatPromptTemplate.fromTemplate(
    'You are a helpful assistant. Synthesize a concise, accurate answer in **Markdown** ' +
    'based on your general knowledge. If the user seems to want vendor documentation, ' +
    'prefer official sources. If there is ambiguity, call it out and list the clarifying questions.\n\n' +
    '### Query\n{query}\n'
  );
  webChain = webPrompt.pipe(llm).pipe(new StringOutputParser());

  // Load & split documents
  const docs = await loadDocuments();
  if (!docs.length) {
    vectorStore = combineChain = null;
    return;
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: config.RAG_CHUNK_SIZE,
    chunkOverlap: config.RAG_CHUNK_OVERLAP,
  });
  const chunks = await splitter.splitDocuments(docs);
  if (!chunks.length) {
    vectorStore = combineChain = null;
    return;
  }

  // Build vector store
  vectorStore = await MemoryVectorStore.fromDocuments(chunks, embeddings);

  // RAG combine chain
  const ragPrompt = ChatPromptTemplate.fromTemplate(
    'Use ONLY the provided context to answer in **Markdown**.\n' +
    "- If the answer is not present in context, reply: 'Not found in documents.'\n" +
    '- Prefer quoting exact lines and list the file and page when possible.\n' +
    '- Return compact, structured bullets.\n\n' +
    '### Context\n{context}\n\n' +
    '### Question\n{input}'
  );
  combineChain = await createStuffDocumentsChain({ llm, prompt: ragPrompt });
}

// ───────────────────────────────────────
//  Two-Stage RAG (retrieve + rerank)
// ───────────────────────────────────────

function cosine(a, b) {
  let dot = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    da += a[i] * a[i];
    db += b[i] * b[i];
  }
  da = Math.sqrt(da);
  db = Math.sqrt(db);
  return (da === 0 || db === 0) ? 0 : dot / (da * db);
}

async function twoStageRag(query) {
  const embeddings = getEmbeddings();
  if (!vectorStore || !embeddings) return { docs: [], maxSim: 0 };

  const first = await vectorStore.similaritySearch(query, config.RAG_TOP_K);
  if (!first.length) return { docs: [], maxSim: 0 };

  const qv = await embeddings.embedQuery(query);
  const docTexts = first.map(d => d.pageContent.slice(0, 4000));
  const dvs = await embeddings.embedDocuments(docTexts);

  const pairs = first.map((d, i) => ({ doc: d, sim: cosine(qv, dvs[i]) }));
  pairs.sort((a, b) => b.sim - a.sim);

  const maxSim = pairs[0]?.sim || 0;
  const reranked = pairs.slice(0, config.RAG_RERANK_K).map(p => p.doc);
  return { docs: reranked, maxSim };
}

// ───────────────────────────────────────
//  Accessors
// ───────────────────────────────────────

function getVectorStore() { return vectorStore; }
function getCombineChain() { return combineChain; }
function getWebChain() { return webChain; }

module.exports = {
  refreshRag,
  twoStageRag,
  getVectorStore,
  getCombineChain,
  getWebChain,
};
