const config = require('../config');

let llm = null;
let nlpLLM = null;
let embeddings = null;

async function initLLM() {
  if (!config.OPENAI_API_KEY) {
    console.warn('OpenAI API Key is missing; RAG/Web/Translate steps will be limited.');
    return;
  }

  const { ChatOpenAI, OpenAIEmbeddings } = require('@langchain/openai');

  embeddings = new OpenAIEmbeddings({
    model: 'text-embedding-3-small',
    openAIApiKey: config.OPENAI_API_KEY,
  });

  llm = new ChatOpenAI({
    model: 'gpt-4o-mini',
    temperature: 0.7,
    openAIApiKey: config.OPENAI_API_KEY,
  });

  // Dedicated NLP model — low temperature for reliable structured JSON output
  nlpLLM = new ChatOpenAI({
    model: config.NLP_MODEL,
    temperature: config.NLP_TEMPERATURE,
    openAIApiKey: config.OPENAI_API_KEY,
  });

  console.log(`[LLM] Chat model: gpt-4o-mini (temp 0.7)`);
  console.log(`[LLM] NLP model: ${config.NLP_MODEL} (temp ${config.NLP_TEMPERATURE})`);
}

function getLLM() { return llm; }
function getNlpLLM() { return nlpLLM; }
function getEmbeddings() { return embeddings; }

module.exports = { initLLM, getLLM, getNlpLLM, getEmbeddings };
