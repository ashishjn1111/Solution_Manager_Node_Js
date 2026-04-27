const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });

const BASE_DIR = path.join(__dirname, '..');

module.exports = {
  // OpenAI
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',

  // ServiceNow
  SN_BASE_URL: process.env.SN_BASE_URL || '',
  SN_USER: process.env.SN_USER || '',
  SN_PASS: process.env.SN_PASS || '',
  SN_FUZZY_SCOPE: (process.env.SN_FUZZY_SCOPE || 'all').toLowerCase(),

  // RAG tuning
  RAG_CHUNK_SIZE: parseInt(process.env.RAG_CHUNK_SIZE || '3000', 10),
  RAG_CHUNK_OVERLAP: parseInt(process.env.RAG_CHUNK_OVERLAP || '450', 10),
  RAG_TOP_K: parseInt(process.env.RAG_TOP_K || '12', 10),
  RAG_RERANK_K: parseInt(process.env.RAG_RERANK_K || '6', 10),
  RAG_MIN_SIM: parseFloat(process.env.RAG_MIN_SIM || '0.28'),
  SN_DEFAULT_DAYS: parseInt(process.env.SN_DEFAULT_DAYS || '60', 10),
  WEB_BIAS_ENABLE: process.env.WEB_BIAS_ENABLE !== '0',

  // NLP
  NLP_MODEL: process.env.NLP_MODEL || 'gpt-4o',
  NLP_TEMPERATURE: parseFloat(process.env.NLP_TEMPERATURE || '0.1'),

  // Translation
  MAX_TRANSLATE_CHARS: parseInt(process.env.MAX_TRANSLATE_CHARS || '12000', 10),
  LANG_LABELS: {
    en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch',
    ja: '日本語', ko: '한국어', ru: 'Русский', zh: '中文',
    ar: 'العربية', hi: 'हिंदी', tl: 'Filipino',
  },
  RTL_LANGS: new Set(['ar']),

  // Server
  PORT: parseInt(process.env.PORT || '5000', 10),
  DEBUG: process.env.FLASK_DEBUG === '1' || process.env.NODE_ENV === 'development',
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || 'http://127.0.0.1:5000').split(',').map(s => s.trim()),

  // Paths
  DATA_DIR: path.join(BASE_DIR, 'data'),
  UPLOAD_DIR: path.join(BASE_DIR, 'data'),
  EXPORT_DIR: path.join(BASE_DIR, 'exported_documents'),
  STATIC_DIR: path.join(BASE_DIR, 'static'),

  // Upload validation
  ALLOWED_EXTENSIONS: new Set([
    'pdf', 'json', 'txt', 'csv', 'doc', 'docx', 'ppt', 'pptx', 'xlsx', 'md', 'html',
  ]),
};
