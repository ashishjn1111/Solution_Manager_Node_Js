const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const exporters = require('../services/exporters');

const router = Router();

const FORMAT_MAP = {
  pdf:  { ext: 'pdf',  mime: 'application/pdf',                                                            fn: exporters.generatePdf },
  word: { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',     fn: exporters.generateWord },
  xlsx: { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',           fn: exporters.generateXlsx },
  ppt:  { ext: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',  fn: exporters.generatePpt },
  csv:  { ext: 'csv',  mime: 'text/csv',                                                                   fn: exporters.generateCsv },
  txt:  { ext: 'txt',  mime: 'text/plain',                                                                 fn: exporters.generateTxt },
};

// ───── POST /export-chat/:format ─────

router.post('/export-chat/:format', async (req, res) => {
  const { format } = req.params;
  const chatData = req.body?.chatData;
  if (!chatData?.length) return res.status(400).json({ error: 'No data' });

  const fmt = FORMAT_MAP[format];
  if (!fmt) return res.status(400).json({ error: 'Invalid format' });

  try {
    const buffer = await fmt.fn(chatData);
    const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
    const filename = `chat_export_${ts}.${fmt.ext}`;

    // Persist to export dir
    fs.mkdirSync(config.EXPORT_DIR, { recursive: true });
    fs.writeFileSync(path.join(config.EXPORT_DIR, filename), buffer);

    res.set({
      'Content-Type': fmt.mime,
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(buffer);
  } catch (err) {
    console.error(`Export error (${format}):`, err);
    res.status(500).json({ error: err.message });
  }
});

// ───── POST /clear-exports ─────

router.post('/clear-exports', (_req, res) => {
  if (fs.existsSync(config.EXPORT_DIR)) {
    for (const f of fs.readdirSync(config.EXPORT_DIR)) {
      const p = path.join(config.EXPORT_DIR, f);
      if (fs.statSync(p).isFile()) fs.unlinkSync(p);
    }
  }
  res.json({ message: 'Exported documents cleared' });
});

module.exports = router;
