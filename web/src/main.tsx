import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { isPdfWindow } from './pdf/pdfWindow';
import './styles/global.css';

// The window that shows only the PDF (see pdf/pdfWindow.ts).
const PdfWindow = lazy(() => import('./components/PdfWindow').then(m => ({ default: m.PdfWindow })));

if (typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('mac')) {
  document.body.classList.add('is-mac');
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found in index.html');

createRoot(rootEl).render(
  <StrictMode>
    {isPdfWindow() ? <Suspense fallback={null}><PdfWindow /></Suspense> : <App />}
  </StrictMode>,
);
