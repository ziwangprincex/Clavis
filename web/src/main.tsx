import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { isPdfWindow } from './pdf/pdfWindow';
import { hasTauri } from './api/tauri';
import './styles/global.css';

// The window that shows only the PDF (see pdf/pdfWindow.ts).
const PdfWindow = lazy(() => import('./components/PdfWindow').then(m => ({ default: m.PdfWindow })));

if (typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('mac')) {
  document.body.classList.add('is-mac');
  // The main window is transparent on macOS (tauri.macos.conf.json) so the
  // sidebar can show the system's sidebar material; everything else paints
  // its own page. The PDF window and the browser preview stay opaque.
  if (hasTauri() && !isPdfWindow()) document.documentElement.classList.add('vibrant');
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found in index.html');

createRoot(rootEl).render(
  <StrictMode>
    {isPdfWindow() ? <Suspense fallback={null}><PdfWindow /></Suspense> : <App />}
  </StrictMode>,
);
