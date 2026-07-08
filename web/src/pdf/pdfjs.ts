// Lazy load pdfjs-dist + configure worker.
//
// The worker is imported with Vite's `?worker&inline` suffix: the worker code
// is bundled into the chunk and instantiated from a blob: URL. This matters in
// the packaged app — WKWebView refuses to spawn workers from the custom
// tauri:// protocol, so a plain `workerSrc` URL silently fails there and no
// PDF ever renders. blob: workers are allowed by our CSP (`worker-src 'self'
// blob:`) and work identically in dev and production.

import * as pdfjsLib from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&inline';

let configured = false;

export function ensurePdfjs(): typeof pdfjsLib {
  if (!configured) {
    pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();
    configured = true;
  }
  return pdfjsLib;
}
