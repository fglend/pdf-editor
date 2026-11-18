import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/** Load a PDF. PDF.js transfers the buffer to its worker, so we hand it a copy. */
export async function loadPdf(bytes) {
  return pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
}

export function pageRotation(pdfPage, extra) {
  return (((pdfPage.rotate + extra) % 360) + 360) % 360;
}

export async function readMetadata(pdfDoc) {
  try {
    const { info } = await pdfDoc.getMetadata();
    return {
      title: info?.Title || '',
      author: info?.Author || '',
      subject: info?.Subject || '',
      creator: info?.Creator || '',
      producer: info?.Producer || '',
      created: parsePdfDate(info?.CreationDate),
      modified: parsePdfDate(info?.ModDate),
      version: info?.PDFFormatVersion || '',
    };
  } catch {
    return {};
  }
}

function parsePdfDate(s) {
  if (!s) return null;
  const d = pdfjsLib.PDFDateString.toDateObject(s);
  return d && !isNaN(d) ? d : null;
}
