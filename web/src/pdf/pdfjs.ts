// Lazy load pdfjs-dist + configure worker.
//
// Vite handles the worker via the `?url` import suffix — that returns a
// hashed URL pointing at the worker script in the build output, which we
// hand off to pdfjs.GlobalWorkerOptions.workerSrc.

import * as pdfjsLib from 'pdfjs-dist';
// Vite-specific: importing with ?url returns the public URL of the asset.
// At build time this is bundled & hashed; in dev it's served from the dev server.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

let configured = false;

export function ensurePdfjs(): typeof pdfjsLib {
  if (!configured) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
    configured = true;
  }
  return pdfjsLib;
}
