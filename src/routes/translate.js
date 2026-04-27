const { Router } = require('express');
const config = require('../config');
const { getLLM } = require('../services/llm');
const { joinToStr, logStep } = require('../utils/helpers');

const router = Router();

router.post('/translate', async (req, res) => {
  let raw = req.body;
  if (Array.isArray(raw)) raw = { text: joinToStr(raw), target: 'en' };
  if (!raw) raw = {};

  let text = joinToStr(raw.text);
  let target = (joinToStr(raw.target) || 'en').toLowerCase();

  if (!text) return res.status(400).json({ error: "Missing 'text'" });
  if (text.length > config.MAX_TRANSLATE_CHARS) {
    return res.status(413).json({ error: `Text too long (>${config.MAX_TRANSLATE_CHARS} chars)` });
  }

  const llm = getLLM();
  if (!llm) return res.status(500).json({ error: 'LLM not configured (missing OPENAI_API_KEY).' });

  const targetName = config.LANG_LABELS[target] || target;

  const prompt = [
    'You are a professional technical translator.',
    `Translate the content below into ${targetName}.`,
    '',
    'Rules:',
    '1) Preserve Markdown, code blocks, URLs, and email addresses exactly.',
    '2) DO NOT translate nor alter ServiceNow record tokens like: ' +
      'INC12345, REQ6789, RITM0001, SCTASK123, KB12345, CHG123, PRB987, TASK123.',
    '3) Keep any numbers, timestamps, and IDs unchanged.',
    '4) Do NOT add explanations, prefaces, or quotes—return ONLY the translated content.',
    '5) If the text is already in the target language, return it unchanged.',
    '',
    '=== CONTENT START ===',
    text,
    '=== CONTENT END ===',
  ].join('\n');

  try {
    const out = await llm.invoke(prompt);
    const translated = typeof out.content === 'string' ? out.content.trim() : joinToStr(out.content);
    logStep('TRANSLATE', { ok: true, target, chars: text.length });
    res.json({ translated, target, rtl: config.RTL_LANGS.has(target) });
  } catch (err) {
    logStep('TRANSLATE', { ok: false, target, err: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
