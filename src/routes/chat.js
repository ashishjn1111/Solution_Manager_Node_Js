const { Router } = require('express');
const config = require('../config');
const { joinToStr, logStep } = require('../utils/helpers');
const { twoStageRag, getCombineChain, getWebChain } = require('../services/rag');
const { getLLM } = require('../services/llm');
const snClient = require('../services/sn-client');

const router = Router();

// ───── Web bias rewrite ─────

const BIAS_RULES = [
  { rx: /outlook|o365|office 365|microsoft 365|exchange/i, add: ' site:support.microsoft.com OR site:learn.microsoft.com' },
  { rx: /vpn|anyconnect|cisco/i, add: ' site:cisco.com' },
  { rx: /servicenow|kb article|kb /i, add: ' site:support.servicenow.com' },
];

function rewriteQueryForWeb(q) {
  if (!config.WEB_BIAS_ENABLE) return String(q || '');
  let qq = String(q || '').trim();
  for (const { rx, add } of BIAS_RULES) {
    if (rx.test(qq)) qq += add;
  }
  return qq;
}

// ───── POST /chat ─────

router.post('/chat', async (req, res) => {
  const query = joinToStr(req.body?.query);
  const source = joinToStr(req.body?.source) || 'web';
  const t0 = Date.now();

  try {
    // ── Documents ──
    if (source === 'documents') {
      const combineChain = getCombineChain();
      if (!combineChain) {
        logStep('DOCS', { ok: false, reason: 'no_chain' });
        return res.status(400).json({ error: 'Upload documents first' });
      }

      const { docs, maxSim } = await twoStageRag(query);
      logStep('DOCS_RETRIEVE', { q: query, rerank_k: docs.length, max_sim: +maxSim.toFixed(4) });

      if (!docs.length) {
        return res.json({ response: 'Not found in documents.', sources: [], mode: 'documents' });
      }
      if (maxSim < config.RAG_MIN_SIM) {
        logStep('DOCS', { ok: false, reason: `below_threshold(${config.RAG_MIN_SIM})`, max_sim: maxSim });
        return res.json({ response: 'No strong matches in uploaded documents.', sources: [], mode: 'documents' });
      }

      const answer = await combineChain.invoke({ input: query, context: docs });
      const srcs = docs.map(d => ({ source: d.metadata?.source, page: d.metadata?.page }));
      logStep('DOCS', { ok: true, src_count: srcs.length, max_sim: +maxSim.toFixed(4), took_ms: Date.now() - t0 });
      return res.json({ response: answer, sources: srcs, mode: 'documents' });
    }

    // ── ServiceNow ──
    if (source === 'servicenow') {
      const { prefix, token } = snClient.parseSNToken(query);
      const snGroup = joinToStr(req.body?.snGroup) || '';
      let results;

      if (prefix && token) {
        results = await snClient.getRecordByNumber(prefix, token);
        logStep('SN_EXACT', { token, count: Array.isArray(results) ? results.length : 'err' });
      } else {
        const days = snClient.parseDaysWindow(query);
        const keywords = snClient.cleanKeywords(query);
        const phrase = snClient.cleanPhrase(query);
        logStep('SN_PARSE', { raw_query: query, keywords: keywords.join(','), phrase, days, group: snGroup || 'all' });

        if (config.SN_FUZZY_SCOPE === 'incident') {
          results = await snClient.fuzzyIncidentSearch(query, 10, days, snGroup);
        } else {
          results = await snClient.fuzzyServicenowSearch(query, 5, days, snGroup);
        }
        logStep('SN_FUZZY', { scope: config.SN_FUZZY_SCOPE, group: snGroup || 'all', count: Array.isArray(results) ? results.length : 'err' });
      }

      if (results?.error) return res.status(500).json(results);
      if (!results?.length) return res.json({ response: 'No matching ServiceNow records found.', mode: 'servicenow' });

      // Detect if results are alternate (partial matches)
      const isAlternate = results.some(r => r._alternate);

      // LLM context
      const contextBlocks = results
        .filter(r => !r._notice)
        .map(r =>
          `Record: ${r.number}\nDescription: ${r.short_description || r.description}\nSolution: ${r.close_notes || 'No solution provided'}\n---`
        );
      const snContext = contextBlocks.length ? contextBlocks.join('\n') : 'No accessible records.';

      // Summarize
      const llm = getLLM();
      let summaryText;
      const searchKeywords = snClient.cleanKeywords(query).join(', ');
      if (llm) {
        const alternateNote = isAlternate
          ? `\nIMPORTANT: No exact matches were found. The records below are partial/related matches. ` +
            `Start your response by clearly stating: "No exact matches found for '${query}'. Here are related records that may help:"\n`
          : '';
        const prompt =
          `User searched for: '${query}' (key terms: ${searchKeywords}).\n` +
          alternateNote +
          `Below are ServiceNow records returned. Summarize ONLY records whose description or solution actually relates to the search terms.\n` +
          `If a record does not mention the search terms, skip it and note it was not relevant.\n\n` +
          `${snContext}\n\nReturn: Top 3 relevant highlights with ticket numbers, brief insights, and next steps. If none are truly relevant, say so clearly.`;
        const llmOut = await llm.invoke(prompt);
        summaryText = typeof llmOut.content === 'string' ? llmOut.content : joinToStr(llmOut.content);
      } else {
        summaryText = isAlternate
          ? `No exact matches found for "${query}". Showing related records:\n\n${snContext}`
          : snContext;
      }

      const enrichedSources = snClient.buildEnrichedSources(results);
      const primary = results.find(r => !r._notice);
      const topNumber = primary?.number?.toUpperCase() || null;
      const topSysId = primary?.sys_id || null;

      let topPrefix = prefix;
      if (!topPrefix && topNumber) {
        for (const p of Object.keys(snClient.TABLE_MAP)) {
          if (topNumber.startsWith(p)) { topPrefix = p; break; }
        }
      }
      const topUrl = (topPrefix && (topNumber || topSysId))
        ? snClient.buildSNUrl(topPrefix, topNumber, topSysId) : null;

      let skipped = null;
      if (results[0]?._skipped) skipped = results[0]._skipped;

      const md = snClient.buildSNMarkdown({
        summaryText: joinToStr(summaryText),
        enrichedSources,
        primaryNumber: topNumber,
        primaryUrl: topUrl,
        scope: config.SN_FUZZY_SCOPE,
        skippedTables: skipped,
        isAlternate,
      });

      logStep('SNOW', { ok: true, count: enrichedSources.length, took_ms: Date.now() - t0 });
      return res.json({
        response: md, mode: 'servicenow', sources: enrichedSources,
        number: topNumber, sys_id: topSysId, url: topUrl,
        short_description: primary?.short_description || null,
      });
    }

    // ── Web (default) ──
    const webChain = getWebChain();
    if (!webChain) return res.status(500).json({ error: 'Web chain unavailable (no OpenAI key?)' });

    const rewritten = rewriteQueryForWeb(query);
    const result = await webChain.invoke({ query: rewritten });
    const formatted = `## 🌐 Web Answer\n\n**Query:** ${rewritten}\n\n${result}`;

    logStep('WEB', { ok: true, rewritten, took_ms: Date.now() - t0 });
    return res.json({ response: formatted, mode: 'web' });

  } catch (err) {
    console.error('Error in /chat:', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
