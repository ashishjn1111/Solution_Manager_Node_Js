# Solution Manager — Detailed Use Case Statement

## Executive Summary

**Solution Manager** is an AI-powered internal support tool built for Deltek teams. It combines document intelligence (RAG), ServiceNow ticket search, web knowledge synthesis, voice search, NLP intent detection, and smart autocomplete into a single conversational interface — eliminating the need to switch between multiple tools, portals, and knowledge bases.

---

## Problem Statement

| Pain Point | Impact |
|------------|--------|
| **Scattered knowledge** — Runbooks, SOPs, and guides live in PDFs, Word docs, spreadsheets, and wikis | Engineers spend 15–30 min searching for answers already documented somewhere |
| **ServiceNow friction** — Finding related incidents, change requests, or KB articles requires navigating complex filters and table structures | Slower triage, repeated incidents, missed prior resolutions |
| **Context switching** — Jumping between ServiceNow, SharePoint, Google, internal docs, and chat tools | Breaks focus, increases mean-time-to-resolution (MTTR) |
| **No intelligent search** — Keyword search fails when the user doesn't know the exact terminology | Relevant documents and tickets go undiscovered |
| **Typos derail searches** — Misspelled IT terms return zero results | Users waste time reformulating queries |
| **Hands-busy situations** — Engineers working on hardware or in meetings can't type queries | Need voice-first interaction |
| **Export overhead** — Compiling findings into reports, handoff docs, or audit records is manual | Time lost on formatting instead of resolving issues |
| **Language barriers** — Global teams need information in multiple languages | Delays in communication and knowledge transfer |

---

## Purpose

Solution Manager provides a **single conversational interface** that:

1. **Understands natural language questions** and routes them to the right data source
2. **Searches uploaded documents** using AI-powered semantic retrieval (not just keyword matching)
3. **Queries ServiceNow** across 8 table types with fuzzy matching and relevance scoring
4. **Synthesizes web knowledge** when internal sources don't have the answer
5. **Accepts voice input** for hands-free search via Web Speech API
6. **Auto-corrects typos** in real time using a 40+ word IT dictionary and GPT-powered spell correction
7. **Suggests completions** as you type, from history and AI-generated queries
8. **Detects intent** using NLP to classify queries and extract entities before search
9. **Exports conversations** in 6 professional formats for audit, handoff, and reporting
10. **Translates responses** into 11+ languages with technical term preservation

---

## Detailed Use Cases

### UC-01: Document-Based Q&A (RAG Mode)

**Actor:** Support Engineer, SysAdmin, DevOps Engineer

**Scenario:** An engineer needs to perform a Tomcat upgrade on a Linux server but doesn't remember the exact steps from the 40-page runbook.

**Flow:**
1. Engineer uploads the "Tomcat Upgrade Linux.pdf" runbook
2. Types: *"What are the pre-upgrade steps for Tomcat on RHEL?"*
3. Solution Manager chunks the document, creates vector embeddings, and performs a 2-stage semantic search:
   - Stage 1: Retrieves top 12 candidate chunks via similarity search
   - Stage 2: Re-ranks by cosine similarity, selects top 6 (threshold ≥ 0.28)
4. GPT-4o-mini synthesizes a clear, step-by-step answer citing specific page numbers
5. Engineer sees the answer with clickable source references back to the original document

**Value:**
- Reduces time-to-answer from **15–30 minutes** (manual search) to **10–15 seconds**
- Works with PDF, DOCX, XLSX, CSV, TXT, MD, HTML, JSON formats
- Handles multi-document knowledge bases (upload as many files as needed)
- Similarity threshold filtering ensures answers are only generated when confidence is high

**Supported Document Types:**
| Format | Example Use |
|--------|-------------|
| PDF | Runbooks, SOPs, vendor documentation |
| DOCX | Internal procedures, project plans |
| XLSX | Configuration matrices, inventory lists |
| CSV | Server lists, IP mappings, change logs |
| TXT/MD | Quick notes, README files |
| HTML | Exported wiki pages, web documentation |
| JSON | API specs, configuration files |

---

### UC-02: ServiceNow Ticket Lookup (Exact Match)

**Actor:** Service Desk Agent, Incident Manager

**Scenario:** A user calls in referencing incident INC0045678. The agent needs to quickly pull up the details without navigating ServiceNow's UI.

**Flow:**
1. Agent types: *"Show me INC0045678"*
2. NLP intent detection classifies this as `ticket_lookup` with high confidence
3. System detects the ServiceNow token pattern (INC + digits)
4. Queries ServiceNow REST API for the exact record
5. Returns formatted details: state, priority, assignment group, description, resolution notes
6. Includes a deep link back to the full record in ServiceNow

**Value:**
- Instant lookup without navigating ServiceNow
- Works for **8 record types**: INC, REQ, RITM, SCTASK, KB, CHG, PRB, TASK
- Deep links allow one-click navigation to the full ServiceNow record
- NLP auto-detects ticket numbers even mid-sentence

**Supported Token Patterns:**
| Prefix | Table | Example |
|--------|-------|---------|
| INC | Incident | INC0045678 |
| REQ | Service Request | REQ0012345 |
| RITM | Request Item | RITM0023456 |
| SCTASK | Catalog Task | SCTASK0034567 |
| KB | Knowledge Base | KB0001234 |
| CHG | Change Request | CHG0005678 |
| PRB | Problem | PRB0002345 |
| TASK | Task | TASK0067890 |

---

### UC-03: ServiceNow Fuzzy Search

**Actor:** Problem Manager, Major Incident Manager, Change Manager

**Scenario:** A major incident occurs with Exchange Online. The problem manager needs to find all related incidents from the past 30 days to identify a pattern.

**Flow:**
1. Manager types: *"Find Exchange Online incidents from the last 30 days"*
2. NLP classifies intent as `ticket_search`, extracts keywords and time window
3. System executes a multi-table fuzzy search across 8 ServiceNow tables simultaneously
4. Two-pass search strategy:
   - Pass 1: Full phrase "Exchange Online"
   - Pass 2: Individual keywords "Exchange", "Online"
5. Results scored by relevance (keyword match + date recency) and deduplicated
6. GPT-4o-mini summarizes findings with deep links to each record

**Value:**
- Finds related records the user didn't know existed
- Cross-table search reveals connections between incidents, problems, and changes
- Date-aware filtering and assignment group filtering reduces noise
- Gracefully handles ServiceNow ACL restrictions (skips blocked tables, reports which were skipped)

---

### UC-04: Web Knowledge Synthesis

**Actor:** Any team member

**Scenario:** An engineer encounters an unfamiliar error with Cisco AnyConnect VPN and needs a quick answer not in internal docs.

**Flow:**
1. Engineer switches to Web mode
2. Types: *"How to fix Cisco AnyConnect error 'VPN establishment capability disabled'?"*
3. System applies vendor-aware biasing (Cisco query → adds site:cisco.com preference)
4. GPT-4o-mini synthesizes a comprehensive answer from general knowledge
5. Engineer gets a clear resolution path

**Value:**
- Vendor-aware biasing surfaces authoritative sources first
- Bias rules for: Microsoft (Outlook/O365), Cisco (VPN), ServiceNow
- LLM synthesizes structured answers instead of returning raw link lists

---

### UC-05: Voice Search

**Actor:** Any team member (especially during hands-busy scenarios)

**Scenario:** A field engineer is under a server rack replacing cables and needs to check a procedure from the runbook but can't type.

**Flow:**
1. Engineer clicks the 🎤 microphone button
2. Browser requests microphone permission via `getUserMedia()` (first time only)
3. Web Speech API begins continuous real-time transcription
4. Status bar shows live interim text: *"Hearing: how to replace fiber module..."*
5. Final transcription populates the input field
6. NLP auto-analyzes the captured text for intent and autocorrection
7. Engineer clicks Send or speaks another query

**Value:**
- Hands-free search when typing isn't practical
- Real-time feedback during speech (interim transcription visible)
- Continuous mode — keeps listening until manually stopped
- Auto-restarts on silence timeout for uninterrupted workflow
- Works in Chrome, Edge, and Safari

**Technical Details:**
- Microphone permission explicitly requested via `navigator.mediaDevices.getUserMedia()`
- Handles errors: no-speech, not-allowed, no-mic-found, network
- Visual states: Idle (blue), Listening (red pulse), Unsupported (gray)

---

### UC-06: Smart Autocomplete

**Actor:** Any user typing a query

**Scenario:** A service desk agent starts typing "show me inc" and wants to quickly complete the query.

**Flow:**
1. As the user types, a dropdown appears with suggestions from two sources:
   - **Local** (instant): Matches from conversation history + common IT query templates
   - **AI** (600ms debounce): GPT-generated completions via `POST /nlp/suggest`
2. Agent uses Arrow keys to navigate, Tab/Enter to select
3. Selected suggestion populates the input field
4. NLP analysis runs automatically on the selected text

**Value:**
- Reduces keystrokes by 50–70% for common queries
- History-based suggestions learn from past searches
- AI suggestions generate context-aware completions
- Keyboard-friendly: full navigation without mouse

**Query Templates (built-in):**
- "Show me INC...", "Find incidents about...", "Search for change requests..."
- "What does our documentation say about...", "How to troubleshoot..."
- "Find knowledge articles about...", "List recent problems with..."

---

### UC-07: Autocorrect & Spell Correction

**Actor:** Any user (especially fast typists)

**Scenario:** An engineer types "find incidnets about exchnage from last 30 dyas" — full of typos.

**Flow:**
1. **Client-side** (instant, on each space/enter): Dictionary of 40+ common IT misspellings auto-corrects:
   - "incidnets" → "incidents", "exchnage" → "exchange"
2. **Server-side** (800ms debounce): NLP analysis returns GPT-corrected version
   - "find incidents about exchange from last 30 days"
3. Input field auto-updates with corrected text
4. Status bar shows: *"Auto-corrected: 'incidnets' → 'incidents'"*

**Value:**
- Zero-friction correction — user doesn't need to retype
- Two-tier system: instant dictionary for common typos, LLM for complex corrections
- Preserves intent while fixing spelling

**Client-Side Dictionary (sample):**
| Typo | Correction | Typo | Correction |
|------|------------|------|------------|
| incidnet | incident | serviec | service |
| exchagne | exchange | passwrod | password |
| netowrk | network | applicaiton | application |
| cofiguration | configuration | databse | database |
| upgarde | upgrade | dployment | deployment |
| tomacat | tomcat | linnux | linux |
| csico | cisco | micorsoft | microsoft |
| windwos | windows | reqeust | request |

---

### UC-08: NLP Intent Detection

**Actor:** System (automatic, transparent to user)

**Scenario:** User types "show me INC0045678 from the network team" — the system needs to understand this is a ticket lookup, not a web search.

**Flow:**
1. As user types (800ms debounce), query is sent to `POST /nlp/analyze`
2. GPT classifies the query and returns structured JSON:
   - **Intent:** `ticket_lookup` (95% confidence)
   - **Entities:** ticket_number=INC0045678, assignment_group="network team"
   - **Suggested source:** servicenow
   - **Summary:** "User wants to look up specific incident INC0045678 from network team"
3. NLP indicator below input shows: intent badge, confidence, suggested source, extracted entities
4. System uses this metadata to optimize search routing

**Intent Classes:**
| Intent | Description | Color |
|--------|-------------|-------|
| `ticket_lookup` | Exact SN ticket reference | Green |
| `ticket_search` | Fuzzy search for SN records | Blue |
| `document_qa` | Question for uploaded docs | Yellow |
| `web_search` | General web knowledge | Purple |
| `greeting` | Hi, hello, etc. | Gray |
| `unclear` | Ambiguous or incomplete | Red |

**Value:**
- Transparent AI reasoning — users see how their query is interpreted
- Entity extraction catches ticket numbers, time windows, groups automatically
- Spell correction + intent in one call (server-side)

---

### UC-09: Multi-Format Export

**Actor:** Team Lead, Auditor, Project Manager

**Scenario:** After a major incident resolution, the team lead needs to compile the troubleshooting conversation into a formal report.

**Flow:**
1. Team lead has a complete chat history
2. Clicks the export button and selects "Word (.docx)"
3. Solution Manager generates a professionally formatted document
4. File is saved to `exported_documents/` and downloaded

**Export Formats:**
| Format | Best For | Library |
|--------|----------|---------|
| **PDF** | Formal reports, audit records | PDFKit |
| **Word (.docx)** | Editable reports, post-incident reviews | docx |
| **Excel (.xlsx)** | Data analysis, trend tracking | ExcelJS |
| **PowerPoint (.pptx)** | Presentations, briefings | pptxgenjs |
| **CSV** | Data import, bulk processing | Native |
| **TXT** | Quick notes, clipboard sharing | Native |

**Export Levels:**
- **Per-message:** Export individual messages with inline buttons
- **Full chat:** Export entire conversation from toolbar
- **Manual text:** Compose custom text in modal and export

---

### UC-10: Multi-Language Translation

**Actor:** Global Support Teams, International Stakeholders

**Scenario:** A resolution guide is in English but the India-based team needs it in Hindi.

**Flow:**
1. Original answer displayed in English
2. User clicks Hindi flag button on the message
3. Server-side GPT translation preserves:
   - Markdown formatting and code blocks
   - ServiceNow ticket numbers (INC/REQ/etc.)
   - URLs, file paths, and technical identifiers
4. "Translated: Hindi" badge appears; Reset button available

**Supported Languages:**
English, Spanish, French, German, Japanese, Korean, Russian, Chinese (Simplified), Arabic (RTL), Hindi, Filipino

---

### UC-11: Document Management

**Actor:** Knowledge Manager, Support Engineer

**Flow:**
1. Upload documents via file picker (multiple files supported)
2. RAG index automatically rebuilds on every upload/delete
3. Document cards show: icon, filename, View/Download/Delete buttons
4. Full reset option clears all documents and vector index

**Supported Formats:** PDF, DOCX, XLSX, CSV, TXT, MD, HTML, JSON, DOC, PPT/PPTX

---

## Composite Use Case: End-to-End Incident Resolution

| Step | Action | Mode | Value |
|------|--------|------|-------|
| 1 | *"Find recent Exchange incidents"* (voice) | Voice + ServiceNow | Hands-free search, finds 5 related incidents |
| 2 | Autocomplete suggests: *"Show me INC0045678"* | Autocomplete | One-click query from suggestion |
| 3 | NLP detects: ticket_lookup, INC0045678 | NLP | Auto-classified, entities extracted |
| 4 | *"What does our Exchange guide say?"* | Documents | Queries uploaded runbook for steps |
| 5 | *"How to verify Exchange health via PowerShell?"* | Web | Microsoft-recommended commands |
| 6 | Translate resolution to Hindi for offshore team | Translate | Instant multi-language sharing |
| 7 | Export full conversation as PDF | Export | Audit-ready report in one click |

**Result:** MTTR reduced from **~45 minutes** to **~10 minutes** through unified AI-assisted investigation.

---

## Solution Value Proposition

### Quantitative Benefits

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Avg. time to find documentation | 15–30 min | 10–15 sec | ~99% faster |
| ServiceNow search & navigation | 5–10 min | 5–10 sec | ~98% faster |
| Report/export generation | 20–40 min (manual) | 5 sec (auto) | ~99% faster |
| Cross-language communication | Hours (manual) | Seconds | Near-instant |
| Context switches per investigation | 4–6 tools | 1 tool | 83% reduction |
| Query typo recovery | Re-type (30 sec) | Auto-fix (0 sec) | 100% eliminated |
| Hands-busy query capability | Not possible | Voice search | New capability |

### Qualitative Benefits

- **Reduced cognitive load** — One interface, one conversation, all sources
- **Knowledge preservation** — Upload tribal knowledge as documents; it becomes searchable forever
- **Consistent quality** — AI-synthesized answers are structured, cited, and reproducible
- **Accessibility** — Voice search, dark/light mode, responsive design, multi-language
- **Intelligent assistance** — NLP understands intent, autocomplete predicts needs, autocorrect fixes typos
- **Audit trail** — Every conversation is exportable as a formal record
- **Security** — Credentials via environment variables, path traversal protection, HTTPS to ServiceNow

---

## Target Users

| Role | Primary Use Cases |
|------|-------------------|
| **Service Desk Agent** | UC-02 (ticket lookup), UC-03 (fuzzy search), UC-06 (autocomplete), UC-10 (translation) |
| **Support Engineer** | UC-01 (document Q&A), UC-05 (voice search), UC-07 (autocorrect), UC-04 (web search) |
| **Incident Manager** | UC-03 (pattern analysis), UC-08 (NLP intent), UC-09 (export reports) |
| **Problem Manager** | UC-03 (cross-table search), UC-01 (root cause docs), UC-09 (exports) |
| **Change Manager** | UC-02 (CHG lookup), UC-01 (change procedure docs) |
| **Knowledge Manager** | UC-11 (doc management), UC-01 (validate KB accuracy) |
| **Team Lead** | UC-09 (reporting), UC-10 (global team communication) |
| **DevOps Engineer** | UC-01 (runbook Q&A), UC-05 (voice — hands-busy), UC-04 (web troubleshooting) |
| **Field Engineer** | UC-05 (voice search), UC-07 (autocorrect on mobile) |

---

## Technical Differentiators

1. **2-Stage RAG Retrieval** — Broad first-pass (k=12) + precision re-ranking (k=6) ensures high relevance
2. **Cosine Similarity Threshold** — Only answers when confidence ≥ 0.28, preventing hallucinated answers
3. **Multi-Table Fuzzy Search** — Searches 8 ServiceNow tables simultaneously with scoring and deduplication
4. **Voice-First Capability** — getUserMedia + Web Speech API with continuous mode and auto-restart
5. **Dual-Tier Autocorrect** — Instant client dictionary (40+ terms) + GPT-powered server correction
6. **NLP Intent Detection** — Real-time query classification with entity extraction and source recommendation
7. **AI Autocomplete** — History-based + GPT-generated suggestions with keyboard navigation
8. **Vendor-Aware Web Biasing** — Auto-prioritizes Microsoft, Cisco, ServiceNow sources
9. **Smart Token Preservation** — Translation preserves technical IDs, markdown, code blocks, SN references
10. **6-Format Export** — One-click conversion to PDF, Word, Excel, PowerPoint, CSV, TXT
