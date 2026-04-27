/**
 * Normalize any value (string, array, null) to a single trimmed string.
 */
function joinToStr(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value.map(v => joinToStr(v)).join(' ').trim();
  }
  return String(value).trim();
}

/**
 * Truncate text with ellipsis.
 */
function clip(text, maxLen = 140) {
  if (text == null) return '';
  const t = String(text);
  return t.length > maxLen ? t.slice(0, maxLen) + '…' : t;
}

/**
 * Structured log for telemetry.
 */
function logStep(step, data = {}) {
  const parts = Object.entries(data)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(' | ');
  console.log(`[${step}] ${parts}`);
}

/**
 * Format sources list for export files.
 */
function formatSourceList(sources) {
  if (!sources || !sources.length) return '';
  return sources
    .map(s => `${s.source || s.title || 'File'} (p.${s.page || 'N/A'})`)
    .join(' | ');
}

module.exports = { joinToStr, clip, logStep, formatSourceList };
