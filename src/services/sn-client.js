const axios = require('axios');
const https = require('https');
const config = require('../config');
const { joinToStr, clip } = require('../utils/helpers');

// Accept self-signed certs for ServiceNow + keep-alive for connection reuse
const snHttpsAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true, maxSockets: 10 });

// ───────────────────────────────────────
//  Simple in-memory cache (TTL-based)
// ───────────────────────────────────────
const SN_CACHE = new Map();
const SN_CACHE_TTL = parseInt(process.env.SN_CACHE_TTL || '120', 10) * 1000; // default 2 min
const SN_CACHE_MAX = 200;

function cacheKey(table, params) {
  return `${table}::${JSON.stringify(params)}`;
}
function cacheGet(key) {
  const entry = SN_CACHE.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > SN_CACHE_TTL) { SN_CACHE.delete(key); return undefined; }
  return entry.data;
}
function cacheSet(key, data) {
  if (SN_CACHE.size >= SN_CACHE_MAX) {
    // evict oldest entry
    const oldest = SN_CACHE.keys().next().value;
    SN_CACHE.delete(oldest);
  }
  SN_CACHE.set(key, { data, ts: Date.now() });
}

// ───────────────────────────────────────
//  Constants
// ───────────────────────────────────────

const SN_TOKEN_REGEX = /\b(?:INC|REQ|RITM|SCTASK|KB|CHG|PRB|TASK)\d+\b/i;
// Matches: "last 30 days", "past two years", "last 6 months", "last week" etc.
const DATE_WINDOW_RX = /\b(?:last|past)\s+(?:(\d{1,4})\s+)?(days?|weeks?|months?|years?)\b/i;
// Also match written-out numbers
const WRITTEN_NUMBERS = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12 };
const WRITTEN_NUM_RX = /\b(?:last|past)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(days?|weeks?|months?|years?)\b/i;

const TABLE_MAP = {
  INC: 'incident',
  REQ: 'sc_request',
  RITM: 'sc_req_item',
  SCTASK: 'sc_task',
  KB: 'kb_knowledge',
  CHG: 'change_request',
  PRB: 'problem',
  TASK: 'task',
};

const SN_TABLE_FIELDS = {
  incident:
    'number,short_description,description,priority,category,subcategory,' +
    'caller_id,assignment_group,assigned_to,state,sys_id,sys_created_on,' +
    'close_notes,comments,work_notes',
  sc_request:
    'number,short_description,description,requested_for,assignment_group,' +
    'assigned_to,state,sys_id,sys_created_on',
  sc_req_item:
    'number,short_description,description,request,assignment_group,' +
    'assigned_to,state,sys_id,sys_created_on,close_notes',
  sc_task:
    'number,short_description,description,assignment_group,assigned_to,' +
    'state,sys_id,sys_created_on,close_notes,work_notes,comments',
  problem:
    'number,short_description,description,priority,assignment_group,' +
    'assigned_to,state,sys_id,sys_created_on,close_notes',
  change_request:
    'number,short_description,description,category,risk,impact,' +
    'assignment_group,assigned_to,state,sys_id,sys_created_on,close_notes',
  kb_knowledge: 'number,short_description,sys_id,sys_created_on',
  task:
    'number,short_description,description,assignment_group,assigned_to,' +
    'state,sys_id,sys_created_on,close_notes',
  _default: 'number,short_description,description,sys_created_on,state,sys_id,close_notes',
};

// ───────────────────────────────────────
//  Helpers
// ───────────────────────────────────────

function snFieldsForTable(table) {
  const val = SN_TABLE_FIELDS[table] || SN_TABLE_FIELDS._default;
  return val || null;
}

function parseSNToken(text) {
  if (!text) return { prefix: null, token: null };
  const m = SN_TOKEN_REGEX.exec(text);
  if (!m) return { prefix: null, token: null };
  const token = m[0].toUpperCase();
  for (const p of Object.keys(TABLE_MAP)) {
    if (token.startsWith(p)) return { prefix: p, token };
  }
  return { prefix: null, token };
}

function buildSNUrl(prefix, number, sysId) {
  if (!prefix || !config.SN_BASE_URL) return config.SN_BASE_URL || '';
  if (prefix === 'KB' && number) {
    return `${config.SN_BASE_URL}/nav_to.do?uri=kb_view.do?sysparm_article=${number}`;
  }
  const table = TABLE_MAP[prefix];
  if (number && table) {
    return `${config.SN_BASE_URL}/nav_to.do?uri=${table}.do?sysparm_query=number=${number}`;
  }
  if (sysId && table) {
    return `${config.SN_BASE_URL}/nav_to.do?uri=${table}.do?sys_id=${sysId}`;
  }
  return config.SN_BASE_URL;
}

function parseDaysWindow(query) {
  if (!query) return config.SN_DEFAULT_DAYS;

  // Try written-out number first: "last two years", "past three months"
  const wm = WRITTEN_NUM_RX.exec(query);
  if (wm) {
    const num = WRITTEN_NUMBERS[wm[1].toLowerCase()] || 1;
    const unit = wm[2].toLowerCase().replace(/s$/, '');
    const days = unit === 'year' ? num * 365 : unit === 'month' ? num * 30 : unit === 'week' ? num * 7 : num;
    return Math.max(1, Math.min(days, 1095));
  }

  // Try numeric: "last 30 days", "last 6 months", "past 2 years"
  const m = DATE_WINDOW_RX.exec(query);
  if (m) {
    const num = m[1] ? parseInt(m[1], 10) : 1; // "last week" = 1 week
    const unit = (m[2] || 'day').toLowerCase().replace(/s$/, '');
    const days = unit === 'year' ? num * 365 : unit === 'month' ? num * 30 : unit === 'week' ? num * 7 : num;
    return Math.max(1, Math.min(days, 1095));
  }

  return config.SN_DEFAULT_DAYS;
}

// ───────────────────────────────────────
//  API calls
// ───────────────────────────────────────

async function snGet(table, queryParams) {
  if (!config.SN_BASE_URL || !config.SN_USER || !config.SN_PASS) {
    return { error: 'ServiceNow credentials not configured.' };
  }

  const fields = queryParams.sysparm_fields || snFieldsForTable(table);
  const limit = parseInt(queryParams.sysparm_limit || 10, 10);

  const paramsPrimary = { ...queryParams, sysparm_limit: limit, sysparm_display_value: 'true' };
  if (fields) paramsPrimary.sysparm_fields = fields;
  delete paramsPrimary.sysparm_limit;
  paramsPrimary.sysparm_limit = limit;

  // Check cache first
  const ck = cacheKey(table, paramsPrimary);
  const cached = cacheGet(ck);
  if (cached !== undefined) return cached;

  const paramsFallback = { ...paramsPrimary };
  delete paramsFallback.sysparm_fields;

  const axiosOpts = {
    auth: { username: config.SN_USER, password: config.SN_PASS },
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    timeout: 15000,
    httpsAgent: snHttpsAgent,
  };

  async function doRequest(params) {
    const resp = await axios.get(
      `${config.SN_BASE_URL}/api/now/table/${table}`,
      { ...axiosOpts, params }
    );
    return resp.data?.result || [];
  }

  try {
    const result = await doRequest(paramsPrimary);
    cacheSet(ck, result);
    return result;
  } catch (err) {
    const code = err.response?.status;
    const text = err.response?.data ? JSON.stringify(err.response.data) : '';
    const retryable =
      [400, 401, 403].includes(code) ||
      /invalid field|field not found|access denied|not authorized|forbidden/i.test(text);

    if (retryable) {
      try {
        const fbResult = await doRequest(paramsFallback);
        cacheSet(ck, fbResult);
        return fbResult;
      } catch (err2) {
        return { error: `${err2.response?.status || 'HTTP'} ${err2.response?.statusText || err2.message}` };
      }
    }
    return { error: `${code || 'HTTP'} ${err.response?.statusText || err.message}` };
  }
}

async function getRecordByNumber(prefix, number) {
  const table = TABLE_MAP[prefix];
  if (!table) return [];
  return snGet(table, { sysparm_query: `number=${number}`, sysparm_limit: 1 });
}

// Strip ALL date/time phrases and stop words so only real search terms remain.
// This ensures "AMI backup" and "ami backup for last two years" produce the same keywords: ["ami", "backup"]
const STOP_WORDS = new Set([
  // articles / prepositions / pronouns
  'the','a','an','in','on','at','to','for','of','and','or','is','it','my','me','we','our',
  'not','no','any','be','do','has','had','was','are','been','being','can','will','would',
  'could','should','may','might','shall','need','that','this','these','those','what','which',
  'who','whom','where','when','how','why','than','then','them','their','its','but','if','so',
  // date / time terms
  'last','past','days','day','weeks','week','months','month','years','year','ago','since','during',
  'one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve',
  // action / command verbs users type
  'show','find','search','get','list','give','recent','from','about','with','all','please',
  'tell','display','fetch','pull','bring','check','look','lookup','retrieve','provide',
  // ServiceNow meta-words (table types / record terminology)
  'incident','incidents','ticket','tickets','record','records','request','requests',
  'issue','issues','problem','problems','task','tasks','change','changes',
  'item','items','case','cases','entry','entries','log','logs',
  // descriptive meta-words
  'related','details','detail','resolution','resolved','resolve','information','info',
  'summary','status','update','updates','report','history','description','solution',
  'regarding','concerning','pertaining','involving','associated',
  'linked','connected','attached','tied','matching','like','similar','same',
]);

// Patterns to strip before keyword extraction (date/time phrases)
const DATE_STRIP_PATTERNS = [
  /\b(?:last|past)\s+(?:\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:days?|weeks?|months?|years?)\b/gi,
  /\b(?:last|past)\s+(?:days?|weeks?|months?|years?)\b/gi,
  /\b(?:from|since)\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/gi,
];

function cleanKeywords(query) {
  let stripped = query;
  for (const rx of DATE_STRIP_PATTERNS) {
    stripped = stripped.replace(rx, '');
  }
  return stripped.trim().split(/\s+/)
    .map(w => w.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));
}
// Return the cleaned full phrase (without date/stop-word noise)
function cleanPhrase(query) {
  return cleanKeywords(query).join(' ');
}

// ── Score results by relevance and filter out irrelevant ones ──
// Returns only results where at least one keyword appears in the record text.
// Phrase matches get heavy bonus, individual keywords get lighter score.
function scoreAndFilter(results, phrase, keywords) {
  if (!Array.isArray(results) || !results.length) return [];
  const minKeywordsRequired = Math.max(1, Math.ceil(keywords.length * 0.5)); // at least half the keywords must match

  for (const r of results) {
    let score = 0;
    let kwMatchCount = 0;
    const grp = typeof r.assignment_group === 'string' ? r.assignment_group
      : (r.assignment_group?.display_value || r.assignment_group?.name || String(r.assignment_group || ''));
    const assignee = typeof r.assigned_to === 'string' ? r.assigned_to
      : (r.assigned_to?.display_value || r.assigned_to?.name || '');
    const hay = [
      (r.short_description || '').toLowerCase(),
      (r.description || '').toLowerCase(),
      (r.close_notes || '').toLowerCase(),
      (r.comments || '').toLowerCase(),
      (r.work_notes || '').toLowerCase(),
      grp.toLowerCase(),
    ];
    const allText = hay.join(' ');

    // Full phrase bonus (heavily weighted)
    if (hay[0].includes(phrase)) score += 20;
    if (hay[1].includes(phrase)) score += 12;
    if (hay[2].includes(phrase)) score += 12;
    if (hay[3].includes(phrase)) score += 6;
    if (hay[4].includes(phrase)) score += 6;
    if (hay[5].includes(phrase)) score += 15;

    // Individual keyword matches — track how many distinct keywords appear
    for (const kw of keywords) {
      const found = allText.includes(kw);
      if (found) kwMatchCount++;
      if (hay[0].includes(kw)) score += 3;
      if (hay[1].includes(kw)) score += 2;
      if (hay[2].includes(kw)) score += 2;
      if (hay[3].includes(kw)) score += 1;
      if (hay[4].includes(kw)) score += 1;
      if (hay[5].includes(kw)) score += 3;
    }

    r._relevance = score;
    r._kwMatchCount = kwMatchCount;
  }

  // Filter: must match at least half the keywords (or all if <= 2 keywords)
  const threshold = keywords.length <= 2 ? keywords.length : minKeywordsRequired;
  const filtered = results.filter(r => r._kwMatchCount >= threshold);

  // Sort by relevance descending, then recency
  filtered.sort((a, b) => {
    if (b._relevance !== a._relevance) return b._relevance - a._relevance;
    return (b.sys_created_on || '').localeCompare(a.sys_created_on || '');
  });

  // If strict filtering removed everything, return best partial matches as alternates
  if (!filtered.length && results.length) {
    const partial = results
      .filter(r => r._kwMatchCount >= 1)
      .sort((a, b) => {
        if (b._relevance !== a._relevance) return b._relevance - a._relevance;
        return (b.sys_created_on || '').localeCompare(a.sys_created_on || '');
      });
    if (partial.length) {
      for (const r of partial) r._alternate = true;
      return partial;
    }
  }

  return filtered;
}

async function fuzzyIncidentSearch(query, limit = 10, days = null, group = '') {
  const t0 = Date.now();
  days = days ?? config.SN_DEFAULT_DAYS;
  const since = new Date(Date.now() - days * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  const searchFields = ['short_description', 'description', 'close_notes', 'comments', 'work_notes', 'assignment_group.name'];
  const phrase = cleanPhrase(query);
  const keywords = cleanKeywords(query);
  if (!keywords.length) return [];
  const groupFilter = group ? `^assignment_group.name=${group}` : '';

  // Pass 1: full phrase search
  const phraseGroups = searchFields.map(f => `sys_created_on>=${since}${groupFilter}^${f}LIKE${phrase}`);
  const phraseQ = phraseGroups.join('^NQ') + '^ORDERBYDESCsys_created_on';
  let results = await snGet('incident', { sysparm_query: phraseQ, sysparm_limit: limit });
  if (Array.isArray(results) && results.length >= limit) {
    return scoreAndFilter(results, phrase, keywords);
  }

  // Pass 2: ALL keywords must appear (not individual OR)
  // Build: (field1 LIKE kw1 OR field2 LIKE kw1 ...) AND (field1 LIKE kw2 OR field2 LIKE kw2 ...)
  if (keywords.length > 1) {
    // Use multi-keyword AND: each keyword must appear in at least one field
    const kwConditions = keywords.map(kw =>
      searchFields.map(f => `${f}LIKE${kw}`).join('^NQ')
    );
    // ServiceNow AND between groups: join with ^  
    const andQ = `sys_created_on>=${since}${groupFilter}^` + kwConditions.map(c => `(${c})`).join('^') + '^ORDERBYDESCsys_created_on';
    const kwResults = await snGet('incident', { sysparm_query: andQ, sysparm_limit: limit });

    // If AND query fails (SN doesn't support parens in all versions), fall back to individual keyword search
    if (kwResults?.error || !Array.isArray(kwResults)) {
      // Fallback: search each keyword individually but require scoring to filter
      const kwGroups = keywords.flatMap(kw => searchFields.map(f => `sys_created_on>=${since}${groupFilter}^${f}LIKE${kw}`));
      const kwQ = kwGroups.join('^NQ') + '^ORDERBYDESCsys_created_on';
      const fallbackResults = await snGet('incident', { sysparm_query: kwQ, sysparm_limit: limit * 2 });
      if (Array.isArray(fallbackResults)) {
        const seen = new Set((results || []).map(r => r.sys_id));
        for (const r of fallbackResults) {
          if (!seen.has(r.sys_id)) { results.push(r); seen.add(r.sys_id); }
        }
      }
    } else {
      const seen = new Set((results || []).map(r => r.sys_id));
      for (const r of kwResults) {
        if (!seen.has(r.sys_id)) { results.push(r); seen.add(r.sys_id); }
      }
    }
  }

  const finalResults = scoreAndFilter(results || [], phrase, keywords).slice(0, limit);
  console.log(`[SN_PERF] fuzzyIncidentSearch: ${Date.now() - t0}ms, ${finalResults.length} results`);
  return finalResults;
}

async function fuzzyServicenowSearch(query, limitPerTable = 5, days = null, group = '') {
  const t0 = Date.now();
  days = days ?? config.SN_DEFAULT_DAYS;
  const since = new Date(Date.now() - days * 86400000).toISOString().replace('T', ' ').slice(0, 19);

  const tables = [
    'incident', 'sc_request', 'sc_req_item', 'sc_task',
    'problem', 'change_request', 'kb_knowledge',
  ];
  const tableSearchFields = {
    incident:       ['short_description', 'description', 'close_notes', 'comments', 'work_notes', 'assignment_group.name'],
    sc_request:     ['short_description', 'description', 'assignment_group.name'],
    sc_req_item:    ['short_description', 'description', 'close_notes', 'assignment_group.name'],
    sc_task:        ['short_description', 'description', 'close_notes', 'work_notes', 'comments', 'assignment_group.name'],
    problem:        ['short_description', 'description', 'close_notes', 'assignment_group.name'],
    change_request: ['short_description', 'description', 'close_notes', 'assignment_group.name'],
    kb_knowledge:   ['short_description', 'number'],
    _default:       ['short_description', 'description', 'close_notes'],
  };
  // Tables that don't have assignment_group
  const noGroupTables = new Set(['kb_knowledge']);

  const phrase = cleanPhrase(query);
  const keywords = cleanKeywords(query);
  if (!keywords.length) return [];

  // ── Search each table in PARALLEL ──
  async function searchOneTable(table) {
    const fields = tableSearchFields[table] || tableSearchFields._default;
    const groupFilter = (group && !noGroupTables.has(table)) ? `^assignment_group.name=${group}` : '';

    // Pass 1: full phrase search
    const phraseGroups = fields.map(f => `sys_created_on>=${since}${groupFilter}^${f}LIKE${phrase}`);
    const phraseQ = phraseGroups.join('^NQ') + '^ORDERBYDESCsys_created_on';
    let tableResults = await snGet(table, { sysparm_query: phraseQ, sysparm_limit: limitPerTable });

    if (tableResults?.error) {
      return { table, skipped: true, error: String(tableResults.error), results: [] };
    }

    // Pass 2: keyword fallback — require ALL keywords, not individual OR
    if ((!tableResults || tableResults.length < limitPerTable) && keywords.length > 1) {
      const kwConditions = keywords.map(kw =>
        fields.map(f => `${f}LIKE${kw}`).join('^NQ')
      );
      const andQ = `sys_created_on>=${since}${groupFilter}^` + kwConditions.map(c => `(${c})`).join('^') + '^ORDERBYDESCsys_created_on';
      let kwResults = await snGet(table, { sysparm_query: andQ, sysparm_limit: limitPerTable });

      // Fallback if SN doesn't support parens
      if (kwResults?.error || !Array.isArray(kwResults)) {
        const kwGroups = keywords.flatMap(kw => fields.map(f => `sys_created_on>=${since}${groupFilter}^${f}LIKE${kw}`));
        const kwQ = kwGroups.join('^NQ') + '^ORDERBYDESCsys_created_on';
        kwResults = await snGet(table, { sysparm_query: kwQ, sysparm_limit: limitPerTable * 2 });
      }

      if (Array.isArray(kwResults)) {
        const seen = new Set((tableResults || []).map(r => r.sys_id));
        for (const r of kwResults) {
          if (!seen.has(r.sys_id)) { tableResults.push(r); seen.add(r.sys_id); }
        }
      }
    }

    for (const r of (tableResults || [])) {
      r._table = r._table || table;
    }
    return { table, skipped: false, results: tableResults || [] };
  }

  // Fire all table searches concurrently
  const settled = await Promise.allSettled(tables.map(t => searchOneTable(t)));

  const allResults = [];
  const skipped = [];
  for (const outcome of settled) {
    if (outcome.status === 'rejected') {
      skipped.push({ table: 'unknown', error: String(outcome.reason) });
      continue;
    }
    const { table, skipped: skip, error, results } = outcome.value;
    if (skip) { skipped.push({ table, error }); continue; }
    allResults.push(...results);
  }

  console.log(`[SN_PERF] fuzzyServicenowSearch: ${tables.length} tables queried in parallel — ${Date.now() - t0}ms`);

  if (!allResults.length && skipped.length) {
    return [{ _notice: 'Some tables not accessible', _skipped: skipped }];
  }

  // Score and filter: remove results that don't contain the search keywords
  const scored = scoreAndFilter(allResults, phrase, keywords);

  // Take top 5 per table, total max 20
  const perTableLimit = 5;
  const totalLimit = 20;
  const tableCounts = {};
  const final = [];
  for (const r of scored) {
    const t = r._table || 'unknown';
    tableCounts[t] = (tableCounts[t] || 0);
    if (tableCounts[t] >= perTableLimit) continue;
    tableCounts[t]++;
    final.push(r);
    if (final.length >= totalLimit) break;
  }
  return final;
}

// ───────────────────────────────────────
//  Response builders
// ───────────────────────────────────────

function buildEnrichedSources(results) {
  return (results || []).map(r => {
    if (r._notice) {
      return { short_description: r._notice, number: null, url: null };
    }
    const num = r.number;
    let rowPrefix = null;
    if (num) {
      const up = num.toUpperCase();
      for (const p of Object.keys(TABLE_MAP)) {
        if (up.startsWith(p)) { rowPrefix = p; break; }
      }
    }
    const resolveRef = (val) => typeof val === 'string' ? val : (val?.display_value || val?.name || '');
    return {
      number: num,
      sys_id: typeof r.sys_id === 'string' ? r.sys_id : (r.sys_id?.value || r.sys_id),
      url: rowPrefix ? buildSNUrl(rowPrefix, num, typeof r.sys_id === 'string' ? r.sys_id : (r.sys_id?.value || r.sys_id)) : null,
      short_description: r.short_description || r.description,
      description: r.description,
      state: resolveRef(r.state),
      category: resolveRef(r.category),
      subcategory: resolveRef(r.subcategory),
      priority: resolveRef(r.priority),
      assignment_group: resolveRef(r.assignment_group),
      assigned_to: resolveRef(r.assigned_to),
      requested_for: resolveRef(r.requested_for),
      request: resolveRef(r.request),
      close_notes: r.close_notes,
      comments: r.comments,
      work_notes: r.work_notes,
      sys_created_on: r.sys_created_on,
      _table: r._table,
    };
  });
}

function buildSNMarkdown({ summaryText, enrichedSources, primaryNumber, primaryUrl, scope, skippedTables, isAlternate }) {
  const lines = [];

  if (isAlternate) {
    lines.push('## ⚠️ No Exact Matches — Showing Related Results', '');
  } else {
    lines.push('## 🔧 ServiceNow Search Results', '');
  }

  // Metadata
  const metadata = [];
  if (primaryNumber) {
    metadata.push(
      primaryUrl
        ? `**🎯 Primary Record:** [${primaryNumber}](${primaryUrl})`
        : `**🎯 Primary Record:** \`${primaryNumber}\``
    );
  }
  if (scope) metadata.push(`**📊 Scope:** \`${scope.charAt(0).toUpperCase() + scope.slice(1)}\``);
  if (metadata.length) {
    lines.push('| | |', '|---|---|');
    for (let i = 0; i < metadata.length; i += 2) {
      lines.push(`| ${metadata[i] || ''} | ${metadata[i + 1] || ''} |`);
    }
    lines.push('');
  }

  // Summary
  lines.push('### 📋 Summary');
  const safeSummary = joinToStr(summaryText);
  lines.push(safeSummary ? '> ' + safeSummary.replace(/\n/g, '\n> ') : '_No summary available._');
  lines.push('');

  // Top records — rendered as HTML grid cards (passed through by marked.js)
  if (enrichedSources?.some(r => r.number)) {
    lines.push(isAlternate ? '### 📋 Related Records (Partial Matches)' : '### 📋 Top Records (Most Relevant)', '');
    const cards = [];
    let count = 0;
    for (const r of enrichedSources) {
      if (!r.number) {
        if (r.short_description) lines.push(`⚠️ ${r.short_description}`);
        continue;
      }
      if (++count > 20) break;

      const typeName = (r._table || 'record').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const numberLink = r.url
        ? `<a href="${r.url}" target="_blank" rel="noopener" class="sn-card-number">${r.number} 🔗</a>`
        : `<span class="sn-card-number">${r.number}</span>`;
      const desc = r.short_description || r.description || 'No description';
      const safeDesc = desc.replace(/</g, '&lt;').replace(/>/g, '&gt;');

      // Date
      const dateStr = r.sys_created_on || '';
      const dateHtml = dateStr ? `<span class="sn-card-date" style="font-size:.68rem;color:#6b7280;">📅 ${dateStr.slice(0,10)}</span>` : '';

      // Badges
      const badges = [];
      if (r.state) {
        const isOpen = /open|new|in progress|active|awaiting/i.test(r.state);
        badges.push(`<span class="sn-badge sn-badge-state${isOpen ? ' open' : ''}">${isOpen ? '🟡' : '🟢'} ${r.state}</span>`);
      }
      if (r.priority) {
        const pClass = /critical|1|high/i.test(r.priority) ? '' : /medium|2/i.test(r.priority) ? ' med' : ' low';
        const pEmoji = pClass === '' ? '🔴' : pClass === ' med' ? '🟡' : '🟢';
        badges.push(`<span class="sn-badge sn-badge-priority${pClass}">${pEmoji} P${r.priority}</span>`);
      }
      const badgeHtml = badges.length ? `<div class="sn-card-badges">${badges.join('')}</div>` : '';

      // Meta line (group / assigned / date)
      const metaParts = [];
      if (r.assignment_group) metaParts.push(`<strong>Group:</strong> ${r.assignment_group}`);
      if (r.assigned_to) metaParts.push(`<strong>Assigned:</strong> ${r.assigned_to}`);
      const metaHtml = metaParts.length || dateHtml
        ? `<div class="sn-card-meta">${metaParts.join(' &middot; ')}${metaParts.length && dateHtml ? ' &middot; ' : ''}${dateHtml}</div>`
        : '';

      // Solution
      const solutionHtml = r.close_notes
        ? `<div class="sn-card-solution"><strong>Solution:</strong> ${clip(joinToStr(r.close_notes), 200).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`
        : '';

      cards.push(
        `<div class="sn-card">` +
          `<div class="sn-card-header">${numberLink}<span class="sn-card-type">${typeName}</span></div>` +
          `<div class="sn-card-desc">${safeDesc}</div>` +
          badgeHtml +
          metaHtml +
          solutionHtml +
        `</div>`
      );
    }

    if (cards.length) {
      lines.push(`<div class="sn-grid">${cards.join('')}</div>`);
    } else {
      lines.push('_No records with numbers found._');
    }
  } else {
    lines.push('### 📋 Top Records', '_No visible records._');
  }
  lines.push('');

  // Skipped tables
  if (skippedTables?.length) {
    lines.push('### ⚠️ Access Issues', 'Some tables could not be queried:', '');
    for (const s of skippedTables) {
      const name = (s.table || 'Unknown').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const err = s.error?.length > 100 ? s.error.slice(0, 97) + '...' : s.error;
      lines.push(`- **${name}:** \`${err}\``);
    }
    lines.push('');
  }

  lines.push('---', '_Generated by ServiceNow Integration_');
  return lines.join('\n');
}

module.exports = {
  TABLE_MAP,
  SN_TOKEN_REGEX,
  parseSNToken,
  buildSNUrl,
  parseDaysWindow,
  cleanKeywords,
  cleanPhrase,
  scoreAndFilter,
  snGet,
  getRecordByNumber,
  fuzzyIncidentSearch,
  fuzzyServicenowSearch,
  buildEnrichedSources,
  buildSNMarkdown,
};
