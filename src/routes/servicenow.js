const { Router } = require('express');
const config = require('../config');
const { joinToStr } = require('../utils/helpers');
const snClient = require('../services/sn-client');

const router = Router();

// ───── GET /servicenow/incident ─────

router.get('/servicenow/incident', async (req, res) => {
  const number = joinToStr(req.query.number);
  const sysId = joinToStr(req.query.sys_id);

  if (!number && !sysId) {
    return res.status(400).json({ error: "Provide either 'number' (e.g., INC0012345) or 'sys_id'" });
  }

  if (number) {
    const m = snClient.SN_TOKEN_REGEX.exec(number);
    if (!m) return res.status(400).json({ error: 'Invalid ServiceNow record number format' });

    const token = m[0].toUpperCase();
    let prefix = null;
    for (const p of Object.keys(snClient.TABLE_MAP)) {
      if (token.startsWith(p)) { prefix = p; break; }
    }
    if (!prefix) return res.status(400).json({ error: `Unsupported record prefix for: ${token}` });

    const results = await snClient.getRecordByNumber(prefix, token);
    if (results?.error) return res.status(500).json(results);
    if (!results?.length) return res.status(404).json({ error: `No record found for ${token}` });

    const r = results[0];
    return res.json({
      number: (r.number || '').toUpperCase(),
      sys_id: r.sys_id,
      url: snClient.buildSNUrl(prefix, r.number, r.sys_id),
      short_description: r.short_description,
      state: r.state,
      sys_created_on: r.sys_created_on,
      description: r.description,
      close_notes: r.close_notes,
      table: snClient.TABLE_MAP[prefix],
    });
  }

  // sys_id lookup
  const table = joinToStr(req.query.table) || 'incident';
  const results = await snClient.snGet(table, { sysparm_query: `sys_id=${sysId}`, sysparm_limit: 1 });
  if (results?.error) return res.status(500).json(results);
  if (!results?.length) return res.status(404).json({ error: `No record found in '${table}' for sys_id=${sysId}` });

  const r = results[0];
  const num = (r.number || '').toUpperCase();
  let inferredPrefix = null;
  for (const p of Object.keys(snClient.TABLE_MAP)) {
    if (num.startsWith(p)) { inferredPrefix = p; break; }
  }

  return res.json({
    number: num || null,
    sys_id: r.sys_id,
    url: snClient.buildSNUrl(inferredPrefix, num || null, r.sys_id),
    short_description: r.short_description,
    state: r.state,
    sys_created_on: r.sys_created_on,
    description: r.description,
    close_notes: r.close_notes,
    table,
  });
});

// ───── GET /servicenow/search ─────

router.get('/servicenow/search', async (req, res) => {
  const q = joinToStr(req.query.q);
  if (!q) return res.status(400).json({ error: "Provide query param 'q' for search" });

  let limit = parseInt(joinToStr(req.query.limit) || '10', 10);
  limit = Math.max(1, Math.min(limit, 50));
  const scope = (joinToStr(req.query.scope) || config.SN_FUZZY_SCOPE).toLowerCase();
  const days = snClient.parseDaysWindow(q);

  let results;
  if (scope === 'all') {
    const perTable = Math.max(1, Math.min(10, Math.floor(limit / 3) || 3));
    results = await snClient.fuzzyServicenowSearch(q, perTable, days);
  } else {
    results = await snClient.fuzzyIncidentSearch(q, limit, days);
  }

  if (results?.error) return res.status(500).json(results);

  const out = (results || []).slice(0, limit).map(r => {
    if (r._notice) return { number: null, short_description: r._notice, url: null, _table: null };
    const num = (r.number || '').toUpperCase();
    let pref = null;
    for (const p of Object.keys(snClient.TABLE_MAP)) {
      if (num.startsWith(p)) { pref = p; break; }
    }
    return {
      number: num || null, sys_id: r.sys_id,
      url: snClient.buildSNUrl(pref, num || null, r.sys_id),
      short_description: r.short_description, state: r.state,
      sys_created_on: r.sys_created_on, description: r.description,
      close_notes: r.close_notes, _table: r._table,
    };
  });

  res.json({ query: q, count: out.length, results: out, scope, days });
});

// ───── GET /servicenow/groups - Fetch assignment groups ─────

router.get('/servicenow/groups', async (req, res) => {
  try {
    const maxGroups = parseInt(joinToStr(req.query.limit) || '1000', 10);
    const pageSize = 200;
    let allGroups = [];
    let offset = 0;

    while (allGroups.length < maxGroups) {
      const batch = await snClient.snGet('sys_user_group', {
        sysparm_query: 'active=true^ORDERBYname',
        sysparm_fields: 'name',
        sysparm_limit: pageSize,
        sysparm_offset: offset,
      });
      if (batch?.error) return res.status(500).json(batch);
      const names = (batch || []).map(r => r.name).filter(Boolean);
      allGroups.push(...names);
      if (!batch || batch.length < pageSize) break;   // last page
      offset += pageSize;
    }

    const groups = [...new Set(allGroups)].sort().slice(0, maxGroups);
    res.json({ groups, total: groups.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ───── GET /servicenow/health ─────

router.get('/servicenow/health', async (req, res) => {
  const tablesStr = joinToStr(req.query.tables) ||
    'incident,sc_task,sc_req_item,sc_request,problem,change_request,kb_knowledge';
  const limit = parseInt(joinToStr(req.query.limit) || '1', 10);

  const out = {};
  for (const t of tablesStr.split(',').map(s => s.trim()).filter(Boolean)) {
    const r = await snClient.snGet(t, { sysparm_query: 'ORDERBYDESCsys_created_on', sysparm_limit: limit });
    if (r?.error) {
      out[t] = { ok: false, error: String(r.error) };
    } else {
      out[t] = { ok: true, count: (r || []).length };
    }
  }
  res.json(out);
});

// ───── GET /config/client - public config for frontend ─────

router.get('/config/client', (_req, res) => {
  res.json({
    SN_BASE_URL: config.SN_BASE_URL || '',
  });
});

// ───── GET /debug-sn ─────

router.get('/debug-sn', (_req, res) => {
  if (!config.DEBUG) return res.status(403).json({ error: 'Debug endpoint disabled in production' });
  res.json({
    SN_BASE_URL: !!config.SN_BASE_URL,
    SN_USER: !!config.SN_USER,
    SN_PASS_SET: !!config.SN_PASS,
    SN_FUZZY_SCOPE: config.SN_FUZZY_SCOPE,
  });
});

module.exports = router;
