'use strict';

// Extracts plain text from a resume / job description / Q&A file.
// Supports PDF (via pdf-parse) and plain text formats.

const fs = require('fs');
const path = require('path');

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.text']);
const MAX_FILE_BYTES = 15 * 1024 * 1024;

async function extractDocumentText(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const stats = fs.statSync(filePath);
  if (stats.size > MAX_FILE_BYTES) {
    throw new Error('File is larger than 15 MB.');
  }

  if (TEXT_EXTENSIONS.has(extension)) {
    return fs.readFileSync(filePath, 'utf8');
  }

  if (extension === '.pdf') {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: fs.readFileSync(filePath) });
    try {
      const result = await parser.getText();
      // pdf-parse marks page breaks with "-- 1 of 3 --"; drop those lines.
      return String(result?.text || '').replace(/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gm, '').trim();
    } finally {
      await parser.destroy?.();
    }
  }

  throw new Error(`Unsupported file type "${extension}". Use PDF, TXT or MD.`);
}

module.exports = {
  extractDocumentText
};
