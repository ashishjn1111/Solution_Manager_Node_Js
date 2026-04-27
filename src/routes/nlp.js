const { Router } = require('express');
const { getNlpLLM } = require('../services/llm');
const { joinToStr, logStep } = require('../utils/helpers');

const router = Router();

// ── NLP intent detection + autocorrect via dedicated NLP model ──

router.post('/nlp/analyze', async (req, res) => {
  const text = joinToStr(req.body?.text);
  if (!text) return res.status(400).json({ error: 'text is required' });

  const t0 = Date.now();
  try {
    const llm = getNlpLLM();
    if (!llm) return res.status(500).json({ error: 'LLM unavailable' });

    const prompt = `You are an expert IT support query classifier. Analyze the query and return ONLY valid JSON — no markdown fences, no explanation.

CLASSIFICATION RULES:
- "ticket_lookup": Query contains a specific ServiceNow ticket number (INC0012345, REQ0012345, RITM, SCTASK, KB, CHG, PRB, TASK followed by digits). The user wants details of ONE specific record.
- "ticket_search": Query asks to FIND or SEARCH for tickets/incidents/requests by keyword, date, group, or description. No specific ticket number given. Examples: "find exchange incidents", "show me recent outages", "incidents from last 30 days".
- "document_qa": Query asks about uploaded documents, internal docs, runbooks, SOPs, procedures, or says "what does our documentation say". Examples: "what does the upgrade guide say", "steps to install tomcat from our docs".
- "web_search": General technical questions, troubleshooting, how-to questions not referencing internal docs or ServiceNow. Examples: "how to restart IIS", "what is DKIM", "fix outlook error 0x800".
- "greeting": Simple greetings like hi, hello, hey, good morning. Nothing else.
- "unclear": Too vague or just 1-2 ambiguous words with no clear intent.

SUGGESTED SOURCE RULES:
- ticket_lookup → "servicenow"
- ticket_search → "servicenow"
- document_qa → "documents"
- web_search → "web"
- greeting → "web"
- unclear → "web"

SPELL CORRECTION: Fix obvious typos (incidnet→incident, exchagne→exchange, serviec→service, passwrod→password, etc.) but preserve the original meaning.

ENTITY EXTRACTION:
- ticket_number: Extract ServiceNow ticket patterns like INC0012345, or null if none
- keywords: The main search terms (2-5 words), excluding stop words
- time_window: Extract phrases like "last 30 days", "past week", "from january", or null
- assignment_group: Extract team/group names if mentioned, or null

Query: "${text}"

{
  "corrected": "",
  "intent": "",
  "confidence": 0.0,
  "entities": {
    "ticket_number": null,
    "keywords": [],
    "time_window": null,
    "assignment_group": null
  },
  "suggested_source": "",
  "summary": ""
}`;

    const result = await llm.invoke(prompt);
    const raw = typeof result.content === 'string' ? result.content : joinToStr(result.content);

    // Extract JSON from response (strip markdown fences if present)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logStep('NLP', { ok: false, reason: 'no_json_in_response', took_ms: Date.now() - t0 });
      return res.status(500).json({ error: 'Failed to parse NLP response' });
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate and clamp confidence
    parsed.confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));

    // Validate intent
    const validIntents = ['ticket_lookup', 'ticket_search', 'document_qa', 'web_search', 'greeting', 'unclear'];
    if (!validIntents.includes(parsed.intent)) parsed.intent = 'unclear';

    // Validate suggested_source
    const validSources = ['web', 'documents', 'servicenow'];
    if (!validSources.includes(parsed.suggested_source)) {
      parsed.suggested_source = parsed.intent.startsWith('ticket') ? 'servicenow'
        : parsed.intent === 'document_qa' ? 'documents' : 'web';
    }

    logStep('NLP', { ok: true, intent: parsed.intent, confidence: parsed.confidence, took_ms: Date.now() - t0 });
    return res.json(parsed);
  } catch (err) {
    console.error('NLP analyze error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ── Autocomplete suggestions ──

router.post('/nlp/suggest', async (req, res) => {
  const partial = joinToStr(req.body?.text);
  if (!partial || partial.length < 2) return res.json({ suggestions: [] });

  const t0 = Date.now();
  try {
    const llm = getNlpLLM();
    if (!llm) return res.json({ suggestions: [] });

    const prompt = `You are an IT support chatbot autocomplete engine. Given the partial query, suggest 5 realistic completions.
Context: This tool searches ServiceNow tickets (incidents, requests, changes, problems, KB articles), internal uploaded documents, and general IT knowledge.

Partial query: "${partial}"

Return ONLY a JSON array of 5 complete query strings. No explanation, no markdown.
Example: ["show me incidents about exchange from last 30 days","show me INC0012345","show me recent network outages","show me problems assigned to server team","show me knowledge articles about VPN"]`;

    const result = await llm.invoke(prompt);
    const raw = typeof result.content === 'string' ? result.content : joinToStr(result.content);

    const arrMatch = raw.match(/\[[\s\S]*\]/);
    if (!arrMatch) return res.json({ suggestions: [] });

    const suggestions = JSON.parse(arrMatch[0]);
    logStep('NLP_SUGGEST', { ok: true, count: suggestions.length, took_ms: Date.now() - t0 });
    return res.json({ suggestions: suggestions.slice(0, 5) });
  } catch (err) {
    console.error('NLP suggest error:', err);
    return res.json({ suggestions: [] });
  }
});

module.exports = router;
