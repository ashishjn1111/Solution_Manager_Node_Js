# Solution Manager — Architecture Document

## System Overview

Solution Manager is a full-stack AI-powered chatbot for IT support built on **Node.js/Express** with **OpenAI GPT-4o-mini** and **LangChain**. It provides a single-page application frontend that communicates with backend services for document Q&A (RAG), ServiceNow integration, web knowledge synthesis, NLP intent detection, voice search, autocomplete, translation, and multi-format export.

---

## High-Level Architecture

```mermaid
flowchart TB
    subgraph Client ["Browser (SPA)"]
        UI["static/index.html<br/>Tailwind CSS + marked.js"]
        Voice["🎤 Voice Search<br/>Web Speech API + getUserMedia"]
        AC["Autocomplete Engine<br/>Local History + AI Suggestions"]
        ACR["Autocorrect<br/>Client Dictionary (40+ terms)"]
        NLP_UI["NLP Indicator<br/>Intent · Confidence · Entities"]
    end

    subgraph Server ["Node.js / Express (port 5000)"]
        MW["Middleware<br/>CORS · JSON (50MB) · Static"]

        subgraph Routes ["API Routes"]
            R_CHAT["POST /chat"]
            R_DOC["POST /upload<br/>GET /serve-document<br/>POST /delete-document<br/>POST /reset-documents"]
            R_EXP["POST /export-chat/:format<br/>POST /clear-exports"]
            R_SN["GET /servicenow/*<br/>GET /config/client"]
            R_TR["POST /translate"]
            R_NLP["POST /nlp/analyze<br/>POST /nlp/suggest"]
        end

        subgraph Services ["Core Services"]
            LLM["llm.js<br/>GPT-4o-mini · text-embedding-3-small"]
            RAG["rag.js<br/>MemoryVectorStore · 2-Stage Retrieval"]
            SNC["sn-client.js<br/>REST Client · Fuzzy Search"]
            EXP["exporters.js<br/>PDF · Word · XLSX · PPT · CSV · TXT"]
        end

        CFG["config.js<br/>Environment Variables"]
        UTIL["helpers.js<br/>joinToStr · clip · logStep"]
    end

    subgraph External ["External Services"]
        OAI["OpenAI API<br/>GPT-4o-mini<br/>text-embedding-3-small"]
        SNOW["ServiceNow<br/>REST API<br/>/api/now/table/*"]
    end

    subgraph Storage ["Local Storage"]
        DATA["data/<br/>Uploaded Documents"]
        EXPD["exported_documents/<br/>Export Files"]
    end

    Client -->|HTTP/JSON| MW
    MW --> Routes
    R_CHAT --> LLM & RAG & SNC
    R_DOC --> RAG
    R_EXP --> EXP
    R_SN --> SNC
    R_TR --> LLM
    R_NLP --> LLM
    LLM --> OAI
    RAG --> OAI
    SNC --> SNOW
    RAG --> DATA
    EXP --> EXPD
    Routes --> CFG & UTIL
```

---

## Request Flow Diagram

```mermaid
sequenceDiagram
    participant U as User
    participant V as Voice/Input
    participant AC as Autocomplete
    participant NLP as NLP Engine
    participant FE as Frontend SPA
    participant BE as Express Server
    participant LLM as OpenAI GPT-4o-mini
    participant RAG as RAG Pipeline
    participant SN as ServiceNow API

    Note over U,V: Input Phase
    U->>V: Type query or click 🎤 mic
    V->>V: getUserMedia() → Speech Recognition
    V->>FE: Transcribed/typed text

    Note over FE,AC: Autocomplete Phase
    FE->>AC: Keystroke event
    AC->>AC: Local match (history + templates)
    AC->>BE: POST /nlp/suggest (debounced 600ms)
    BE->>LLM: Generate 5 suggestions
    LLM-->>BE: Suggestions array
    BE-->>AC: AI suggestions
    AC-->>FE: Merged dropdown

    Note over FE,NLP: NLP Analysis Phase
    FE->>BE: POST /nlp/analyze (debounced 800ms)
    BE->>LLM: Classify intent + extract entities
    LLM-->>BE: {intent, confidence, entities, corrected, suggested_source}
    BE-->>FE: NLP result
    FE->>NLP: Display intent badge, confidence, entities
    FE->>FE: Apply autocorrection if needed

    Note over FE,SN: Chat Phase (3-Step Parallel Search)
    FE->>BE: POST /chat {query, source: "web"}
    FE->>BE: POST /chat {query, source: "documents"}
    FE->>BE: POST /chat {query, source: "servicenow"}

    par Web Search
        BE->>LLM: Web synthesis (vendor bias)
        LLM-->>BE: Markdown answer
    and Document Search
        BE->>RAG: twoStageRag(query)
        RAG->>LLM: Embed query
        RAG->>RAG: Stage 1: Top-12 similarity
        RAG->>RAG: Stage 2: Cosine rerank → Top-6
        RAG->>LLM: Synthesize from context
        LLM-->>BE: Answer + sources
    and ServiceNow Search
        BE->>SN: Token match OR fuzzy search
        SN-->>BE: Records (up to 20)
        BE->>LLM: Summarize top results
        LLM-->>BE: Summary + enriched sources
    end

    BE-->>FE: Three responses (streamed as completed)
    FE->>U: Render markdown cards + source chips
```

---

## RAG Pipeline Architecture

```mermaid
flowchart LR
    subgraph Ingestion ["Document Ingestion"]
        UP["Upload<br/>POST /upload"] --> PARSE["Parser<br/>PDF · DOCX · XLSX<br/>CSV · TXT · MD<br/>HTML · JSON"]
        PARSE --> SPLIT["Text Splitter<br/>Recursive Character<br/>chunk=3000 · overlap=450"]
        SPLIT --> EMBED["Embeddings<br/>text-embedding-3-small"]
        EMBED --> VS["MemoryVectorStore<br/>(in-memory index)"]
    end

    subgraph Query ["Query Pipeline"]
        Q["User Query"] --> QE["Query Embedding"]
        QE --> S1["Stage 1<br/>Similarity Search<br/>k=12"]
        S1 --> S2["Stage 2<br/>Cosine Rerank<br/>k=6 · threshold ≥ 0.28"]
        S2 --> CTX["Build Context<br/>Join top chunks"]
        CTX --> LLM["GPT-4o-mini<br/>Combine Chain"]
        LLM --> ANS["Markdown Answer<br/>+ Source Citations"]
    end

    VS -.->|Vector Lookup| S1
```

**Key Parameters:**
| Parameter | Value | Purpose |
|-----------|-------|---------|
| `RAG_CHUNK_SIZE` | 3000 | Characters per chunk |
| `RAG_CHUNK_OVERLAP` | 450 | Overlap between chunks |
| `RAG_TOP_K` | 12 | Stage 1 retrieval count |
| `RAG_RERANK_K` | 6 | Stage 2 final results |
| `RAG_MIN_SIM` | 0.28 | Minimum cosine similarity |

---

## ServiceNow Integration Architecture

```mermaid
flowchart TB
    Q["User Query"] --> DETECT{"Token Detected?<br/>INC/REQ/RITM/SCTASK<br/>KB/CHG/PRB/TASK"}

    DETECT -->|Yes| EXACT["Exact Record Lookup<br/>getRecordByNumber()"]
    EXACT --> API1["GET /api/now/table/{table}<br/>?number={number}"]

    DETECT -->|No| SCOPE{"SN_FUZZY_SCOPE?"}
    SCOPE -->|incident| FUZZ_INC["fuzzyIncidentSearch()"]
    SCOPE -->|all| FUZZ_ALL["fuzzyServicenowSearch()<br/>7 tables in parallel"]

    FUZZ_INC --> PASS1["Pass 1: Phrase Match"]
    FUZZ_INC --> PASS2["Pass 2: Keyword Match"]
    FUZZ_ALL --> PASS1
    FUZZ_ALL --> PASS2

    PASS1 --> SCORE["Score & Rank<br/>Phrase weight + Date recency"]
    PASS2 --> SCORE
    SCORE --> DEDUP["Deduplicate<br/>by sys_id"]
    DEDUP --> ENRICH["buildEnrichedSources()<br/>Deep links · Badges · Metadata"]

    API1 --> ENRICH
    ENRICH --> LLM["GPT-4o-mini<br/>Summarize Top Findings"]
    LLM --> GRID["HTML Grid Cards<br/>State · Priority · Solution"]

    subgraph Tables ["Supported Tables (8)"]
        T1["incident"]
        T2["sc_request"]
        T3["sc_req_item"]
        T4["sc_task"]
        T5["problem"]
        T6["change_request"]
        T7["kb_knowledge"]
        T8["task"]
    end

    FUZZ_ALL --> Tables
```

---

## NLP & Voice Search Architecture

```mermaid
flowchart TB
    subgraph Input ["Input Methods"]
        KB["⌨️ Keyboard Input"]
        MIC["🎤 Voice Input"]
    end

    MIC --> PERM["getUserMedia()<br/>Request Mic Permission"]
    PERM --> SR["SpeechRecognition<br/>continuous=true<br/>interimResults=true"]
    SR --> INTERIM["Live Transcription<br/>(interim results in input)"]
    SR --> FINAL["Final Transcript"]

    KB --> TEXT["Input Text"]
    FINAL --> TEXT

    subgraph Autocorrect ["Client Autocorrect"]
        TEXT --> DICT["Dictionary Lookup<br/>40+ IT term corrections<br/>(instant, on space/enter)"]
        DICT --> CORRECTED["Corrected Text"]
    end

    subgraph Autocomplete ["Autocomplete Engine"]
        CORRECTED --> LOCAL["Local Match<br/>History + 16 Templates<br/>(instant)"]
        CORRECTED --> AI_SUG["POST /nlp/suggest<br/>(600ms debounce)"]
        AI_SUG --> LLM1["GPT-4o-mini<br/>5 Suggestions"]
        LOCAL --> DROPDOWN["Dropdown Menu<br/>Arrow keys · Tab · Enter"]
        LLM1 --> DROPDOWN
    end

    subgraph NLP_Analysis ["NLP Intent Detection"]
        CORRECTED --> ANALYZE["POST /nlp/analyze<br/>(800ms debounce)"]
        ANALYZE --> LLM2["GPT-4o-mini<br/>Structured JSON"]
        LLM2 --> RESULT["Intent Classification"]
    end

    subgraph NLP_Output ["NLP Output"]
        RESULT --> INTENT["Intent Badge<br/>ticket_lookup · ticket_search<br/>document_qa · web_search<br/>greeting · unclear"]
        RESULT --> CONF["Confidence %"]
        RESULT --> ENT["Entities<br/>ticket_number · keywords<br/>time_window · assignment_group"]
        RESULT --> SRC["Suggested Source<br/>web · documents · servicenow"]
        RESULT --> SPELL["Server Autocorrect<br/>LLM spell correction"]
    end

    DROPDOWN --> SEND["Send Query"]
    SEND --> CHAT["POST /chat<br/>(3-step parallel search)"]
```

---

## Export & Translation Architecture

```mermaid
flowchart LR
    subgraph Export ["Multi-Format Export"]
        CHAT["Chat Data<br/>{sender, text, mode, sources}"]
        CHAT --> PDF["PDFKit<br/>→ .pdf"]
        CHAT --> WORD["docx<br/>→ .docx"]
        CHAT --> XLSX["ExcelJS<br/>→ .xlsx"]
        CHAT --> PPT["pptxgenjs<br/>→ .pptx"]
        CHAT --> CSV["Native<br/>→ .csv"]
        CHAT --> TXT["Native<br/>→ .txt"]
    end

    subgraph Translate ["LLM Translation"]
        MSG["Bot Message"] --> TR_REQ["POST /translate<br/>{text, target}"]
        TR_REQ --> PRESERVE["Preserve:<br/>• Markdown formatting<br/>• SN tokens (INC/REQ/...)<br/>• URLs & code blocks<br/>• Numbers & timestamps"]
        PRESERVE --> GPT["GPT-4o-mini"]
        GPT --> OUT["Translated Text<br/>+ RTL flag (Arabic)"]
    end

    subgraph Languages ["11 Languages"]
        L1["English · Spanish · French"]
        L2["German · Japanese · Korean"]
        L3["Russian · Chinese · Arabic"]
        L4["Hindi · Filipino"]
    end
```

---

## Project Structure

```
Solution_Manager/
├── server.js                    # Express entry point (port 5000)
├── package.json                 # Dependencies & scripts
├── .env                         # Environment variables (not committed)
├── setup-node.ps1               # Windows setup script
├── run-node.bat                 # Windows run script
│
├── src/
│   ├── config.js                # All configuration & env vars
│   ├── routes/
│   │   ├── chat.js              # POST /chat (web/documents/servicenow)
│   │   ├── documents.js         # Upload, serve, delete, reset documents
│   │   ├── exports.js           # POST /export-chat/:format (6 formats)
│   │   ├── servicenow.js        # SN incident, search, groups, health
│   │   ├── translate.js         # POST /translate (11 languages)
│   │   └── nlp.js               # POST /nlp/analyze, POST /nlp/suggest
│   ├── services/
│   │   ├── llm.js               # OpenAI GPT-4o-mini + embeddings init
│   │   ├── rag.js               # RAG pipeline (load, split, embed, query)
│   │   ├── sn-client.js         # ServiceNow REST client + fuzzy search
│   │   └── exporters.js         # PDF, Word, XLSX, PPT, CSV, TXT generators
│   └── utils/
│       └── helpers.js           # joinToStr, clip, logStep, formatSourceList
│
├── static/
│   └── index.html               # Complete SPA frontend (~1500+ lines)
│                                  • Voice search (Web Speech API)
│                                  • Autocomplete (local + AI)
│                                  • Autocorrect (client dictionary)
│                                  • NLP intent indicator
│                                  • 3-step chat flow
│                                  • Translation (11 languages)
│                                  • Export controls
│                                  • Dark/light mode
│                                  • Document management
│                                  • Conversation history sidebar
│
├── data/                        # Uploaded documents (RAG source)
└── exported_documents/          # Generated export files
```

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Runtime** | Node.js 18+ | Server runtime |
| **Framework** | Express.js 4.21 | HTTP server, routing, middleware |
| **LLM** | OpenAI GPT-4o-mini | Chat completions, NLP analysis, translation, web synthesis |
| **Embeddings** | text-embedding-3-small | Document & query vector embeddings |
| **Orchestration** | LangChain 0.3 | Chains, prompts, text splitters, vector store |
| **Vector Store** | MemoryVectorStore | In-memory similarity search |
| **ServiceNow** | Axios + REST API | ITSM data retrieval (8 table types) |
| **Voice** | Web Speech API + getUserMedia | Browser-native speech-to-text |
| **NLP** | GPT-4o-mini (structured JSON) | Intent detection, entity extraction, autocorrect |
| **PDF Parse** | pdf-parse 1.1 | PDF text extraction |
| **Word Parse** | mammoth 1.8 | DOCX text extraction |
| **Excel** | ExcelJS 4.4 | XLSX read/write |
| **PDF Export** | PDFKit 0.15 | PDF generation |
| **Word Export** | docx 9.0 | DOCX generation |
| **PPT Export** | pptxgenjs 4.0 | PPTX generation |
| **File Upload** | Multer 1.4 | Multipart form data handling |
| **Frontend** | Tailwind CSS (CDN) | Responsive UI styling |
| **Markdown** | marked.js (CDN) | Markdown → HTML rendering |
| **State** | localStorage | Conversation history, theme, font size |

---

## API Endpoints Summary

### Chat & Search
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/chat` | Main chat (web/documents/servicenow modes) |

### NLP & Intelligence
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/nlp/analyze` | Intent detection + entity extraction + autocorrect |
| POST | `/nlp/suggest` | AI-powered autocomplete suggestions |

### Document Management
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/upload` | Upload document for RAG indexing |
| GET | `/serve-document` | Retrieve uploaded document |
| POST | `/delete-document` | Delete single document |
| POST | `/reset-documents` | Delete all documents |

### Export
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/export-chat/:format` | Export chat (pdf/word/xlsx/ppt/csv/txt) |
| POST | `/clear-exports` | Clear exported files |

### ServiceNow
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/servicenow/incident` | Fetch single incident by number/sys_id |
| GET | `/servicenow/search` | Fuzzy multi-table search |
| GET | `/servicenow/groups` | List assignment groups |
| GET | `/servicenow/health` | Table accessibility check |
| GET | `/config/client` | Public client config |
| GET | `/debug-sn` | Debug ServiceNow connection (dev only) |

### Translation
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/translate` | Translate text to target language |

---

## Security Considerations

| Area | Implementation |
|------|---------------|
| **Credentials** | Environment variables via `.env` (never committed) |
| **Path Traversal** | Blocked in document upload/serve (rejects `..` in paths) |
| **File Whitelist** | Only approved extensions accepted for upload |
| **CORS** | Configurable allowed origins |
| **ServiceNow Auth** | Basic auth over HTTPS |
| **Body Limit** | 50MB JSON limit prevents oversized payloads |
| **Input Sanitization** | Export filenames sanitized before write |

---

## Deployment

```mermaid
flowchart LR
    DEV["Developer Machine<br/>(Windows/Linux)"]
    DEV -->|1. Clone repo| REPO["Source Code"]
    REPO -->|2. npm install| DEPS["Dependencies"]
    DEPS -->|3. Configure .env| ENV["Environment<br/>OPENAI_API_KEY<br/>SN_BASE_URL<br/>SN_USER / SN_PASS"]
    ENV -->|4. node server.js| SERVER["Express Server<br/>:5000"]
    SERVER -->|Serves| SPA["Browser SPA<br/>http://localhost:5000"]
    SERVER -->|Calls| OAI["OpenAI API"]
    SERVER -->|Calls| SN["ServiceNow REST API"]
```

**Quick Start:**
```bash
# 1. Install dependencies
npm install

# 2. Create .env with API keys
cp .env.example .env

# 3. Start server
npm start        # production
npm run dev      # development (hot-reload)
```
