import * as pdfjs from 'pdfjs-dist';
import * as mammoth from 'mammoth';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href;

const MAX_DOCUMENT_CHARS = 160_000;

function normalizeDocumentText(text: string): string {
  const normalized = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!normalized) throw new Error('No readable text was found in this resume.');
  if (normalized.length > MAX_DOCUMENT_CHARS) {
    throw new Error('Resume text is too long to process. Please use a shorter document.');
  }
  return normalized;
}

async function extractPdfText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const pdfDoc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdfDoc.numPages; pageNumber++) {
    const page = await pdfDoc.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    pages.push(text);
  }
  return pages.join('\n\n');
}

async function extractDocxText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

export async function extractDocumentText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf');
  const isDocx =
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    name.endsWith('.docx');

  if (!isPdf && !isDocx) throw new Error('Only PDF and DOCX files are supported.');

  try {
    const text = isPdf ? await extractPdfText(file) : await extractDocxText(file);
    return normalizeDocumentText(text);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith('No readable text') ||
        error.message.startsWith('Resume text is too long'))
    )
      throw error;
    throw new Error('Could not read text from this resume.');
  }
}
