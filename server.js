const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./src/config');
const { initLLM } = require('./src/services/llm');
const { refreshRag } = require('./src/services/rag');

// Route modules
const chatRoutes = require('./src/routes/chat');
const documentRoutes = require('./src/routes/documents');
const exportRoutes = require('./src/routes/exports');
const servicenowRoutes = require('./src/routes/servicenow');
const translateRoutes = require('./src/routes/translate');
const nlpRoutes = require('./src/routes/nlp');

const app = express();

// ───── Middleware ─────

app.use(cors({ origin: config.ALLOWED_ORIGINS }));
app.use(express.json({ limit: '50mb' }));
app.use(express.static(config.STATIC_DIR));

// ───── Routes ─────

app.use(chatRoutes);
app.use(documentRoutes);
app.use(exportRoutes);
app.use(servicenowRoutes);
app.use(translateRoutes);
app.use(nlpRoutes);

// Serve frontend
app.get('/', (_req, res) => {
  res.sendFile(path.join(config.STATIC_DIR, 'index.html'));
});

// ───── Global error handler ─────

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ───── Start ─────

async function start() {
  // Ensure working directories exist
  fs.mkdirSync(config.DATA_DIR, { recursive: true });
  fs.mkdirSync(config.EXPORT_DIR, { recursive: true });

  // Initialize LLM + RAG
  await initLLM();
  if (config.OPENAI_API_KEY) {
    console.log('Building RAG index...');
    await refreshRag();
    console.log('RAG index ready.');
  }

  const server = app.listen(config.PORT, () => {
    console.log(`Server running on http://localhost:${config.PORT}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\nPort ${config.PORT} is already in use.`);
      console.error('Run this to free it:');
      console.error(`  Get-Process -Name "node" | Stop-Process -Force\n`);
      process.exit(1);
    }
    throw err;
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
