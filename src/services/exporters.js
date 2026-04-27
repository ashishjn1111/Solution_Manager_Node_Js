const { formatSourceList } = require('../utils/helpers');

// ───────────────────────────────────────
//  PDF (PDFKit)
// ───────────────────────────────────────

function generatePdf(chatData) {
  return new Promise((resolve, reject) => {
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).fillColor('#1a1a2e').text('AI Chat Export', { align: 'center' });
    doc.moveDown();

    for (const item of chatData) {
      const isUser = item.sender === 'user';
      doc.fontSize(10).fillColor(isUser ? '#00008b' : '#000');
      doc.text(`[${item.timestamp}] ${item.sender.toUpperCase()}: `, { continued: true, bold: true });
      doc.text(String(item.text));
      if (item.sources?.length) {
        doc.fontSize(8).fillColor('#cc0000').text(`Sources: ${formatSourceList(item.sources)}`);
      }
      doc.moveDown(0.5);
    }

    doc.end();
  });
}

// ───────────────────────────────────────
//  Word (docx)
// ───────────────────────────────────────

async function generateWord(chatData) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');

  const children = [
    new Paragraph({ text: 'AI Chat Export', heading: HeadingLevel.TITLE }),
  ];

  for (const item of chatData) {
    children.push(new Paragraph({
      spacing: { before: 120, after: 80 },
      children: [
        new TextRun({ text: `[${item.timestamp}] ${item.sender.toUpperCase()}: `, bold: true }),
        new TextRun({ text: String(item.text) }),
      ],
    }));
    if (item.sources?.length) {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: `Sources: ${formatSourceList(item.sources)}`, italics: true, size: 16 }),
        ],
      }));
    }
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

// ───────────────────────────────────────
//  XLSX (ExcelJS)
// ───────────────────────────────────────

async function generateXlsx(chatData) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Chat Export');

  ws.columns = [
    { header: 'Timestamp', key: 'ts', width: 22 },
    { header: 'Sender', key: 'sender', width: 10 },
    { header: 'Mode', key: 'mode', width: 14 },
    { header: 'Text', key: 'text', width: 80 },
    { header: 'Sources', key: 'sources', width: 40 },
  ];

  for (const item of chatData) {
    ws.addRow({
      ts: item.timestamp,
      sender: item.sender,
      mode: item.mode || '',
      text: String(item.text),
      sources: formatSourceList(item.sources),
    });
  }

  return wb.xlsx.writeBuffer();
}

// ───────────────────────────────────────
//  PPTX (PptxGenJS)
// ───────────────────────────────────────

async function generatePpt(chatData) {
  const PptxGenJS = require('pptxgenjs');
  const pptx = new PptxGenJS();

  const titleSlide = pptx.addSlide();
  titleSlide.addText('AI Chat Export', { x: 1, y: 2, w: 8, h: 1.5, fontSize: 28, bold: true, align: 'center' });
  titleSlide.addText('Conversation summary', { x: 1, y: 3.5, w: 8, h: 1, fontSize: 14, align: 'center', color: '666666' });

  for (const item of chatData) {
    const slide = pptx.addSlide();
    slide.addText(`${item.sender.toUpperCase()} — ${item.timestamp}`, {
      x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 18, bold: true,
    });
    slide.addText(String(item.text).slice(0, 2000), {
      x: 0.5, y: 1.2, w: 9, h: 5, fontSize: 12, valign: 'top',
    });
  }

  return pptx.write({ outputType: 'nodebuffer' });
}

// ───────────────────────────────────────
//  CSV
// ───────────────────────────────────────

function generateCsv(chatData) {
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Timestamp', 'Sender', 'Mode', 'Text', 'Sources'].map(escape).join(',')];

  for (const item of chatData) {
    rows.push([
      item.timestamp,
      item.sender,
      item.mode || '',
      String(item.text).replace(/\n/g, ' '),
      formatSourceList(item.sources),
    ].map(escape).join(','));
  }

  return Buffer.from(rows.join('\n'), 'utf-8');
}

// ───────────────────────────────────────
//  TXT
// ───────────────────────────────────────

function generateTxt(chatData) {
  const lines = ['AI Chat Export', '====================', ''];
  for (const item of chatData) {
    lines.push(`[${item.timestamp}] ${item.sender.toUpperCase()}: ${String(item.text)}`);
    if (item.sources?.length) {
      lines.push(`Sources: ${formatSourceList(item.sources)}`);
    }
    lines.push('');
  }
  return Buffer.from(lines.join('\n'), 'utf-8');
}

module.exports = {
  generatePdf,
  generateWord,
  generateXlsx,
  generatePpt,
  generateCsv,
  generateTxt,
};
