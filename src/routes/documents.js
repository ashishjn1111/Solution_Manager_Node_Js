const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const { refreshRag } = require('../services/rag');

// ───── Multer setup with validation ─────

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });
    cb(null, config.UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    cb(null, path.basename(file.originalname));
  },
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const name = file.originalname;
    const ext = name.split('.').pop().toLowerCase();
    if (name.includes('..') || !config.ALLOWED_EXTENSIONS.has(ext)) {
      return cb(new Error(`Unsupported file type: .${ext}`));
    }
    cb(null, true);
  },
});

const router = Router();

// ───── POST /upload ─────

router.post('/upload', upload.array('document'), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No file' });
  await refreshRag();
  res.json({ message: 'Uploaded' });
});

// ───── GET /serve-document ─────

router.get('/serve-document', (req, res) => {
  const file = req.query.file;
  if (!file) return res.status(400).json({ error: 'No file specified' });

  const safeName = path.basename(file);
  if (safeName !== file || file.includes('..')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const filePath = path.join(config.UPLOAD_DIR, safeName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.sendFile(filePath);
});

// ───── POST /delete-document ─────

router.post('/delete-document', async (req, res) => {
  const filename = req.body?.filename;
  if (!filename) return res.status(400).json({ error: 'No filename' });

  const safeName = path.basename(filename);
  if (safeName !== filename || filename.includes('..')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const filePath = path.join(config.UPLOAD_DIR, safeName);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    fs.unlinkSync(filePath);
    await refreshRag();
    return res.json({ message: `Deleted ${safeName}` });
  }
  res.status(404).json({ error: 'File not found' });
});

// ───── POST /reset-documents ─────

router.post('/reset-documents', async (req, res) => {
  if (fs.existsSync(config.UPLOAD_DIR)) {
    for (const f of fs.readdirSync(config.UPLOAD_DIR)) {
      const p = path.join(config.UPLOAD_DIR, f);
      if (fs.statSync(p).isFile()) fs.unlinkSync(p);
    }
  }
  await refreshRag();
  res.json({ message: 'Reset complete' });
});

module.exports = router;
