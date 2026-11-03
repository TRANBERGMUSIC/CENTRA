/** PDF for preview through Mozilla's pdf.js (scripts in a PDF never run; XFA forms are off). */
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import worker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = worker;

export function openPdf(data: Uint8Array) {
  const base = new URL('pdfjs/', document.baseURI).href;
  return pdfjs.getDocument({
    data, enableXfa: false,
    standardFontDataUrl: `${base}standard_fonts/`, wasmUrl: `${base}wasm/`,
  });
}
