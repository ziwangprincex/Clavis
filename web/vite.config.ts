import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Strip non-woff2 font references from KaTeX's CSS @font-face declarations.
 *
 * KaTeX ships each font in three formats (woff2 / woff / ttf) and lists all
 * three in `src: url(...woff2), url(...woff), url(...ttf)`. Tauri's WebView
 * (modern WebView2 / WKWebView) supports woff2 universally — the woff & ttf
 * fallbacks just bloat the bundle by ~600KB without ever being fetched.
 *
 * This transform removes the woff and ttf segments at build time so Vite never
 * emits those font assets in the first place.
 */
function stripKatexFontFallbacks(): Plugin {
  return {
    name: 'clavis:strip-katex-font-fallbacks',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('katex') || !id.endsWith('.css')) return null;
      // Match: , url(...woff) format("woff") | , url(...ttf) format("truetype")
      const next = code.replace(
        /,\s*url\([^)]+\.woff\)\s*format\("woff"\)|,\s*url\([^)]+\.ttf\)\s*format\("truetype"\)/g,
        '',
      );
      return next === code ? null : { code: next, map: null };
    },
  };
}

// Tauri 1.x dev server expects a fixed port and direct asset paths.
export default defineConfig({
  plugins: [stripKatexFontFallbacks(), react()],
  // Use relative paths so the built bundle works from a file:// or tauri://
  // origin without absolute path assumptions.
  base: './',
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    // Keep sourcemaps for production debugging (Tauri ships them locally only).
    sourcemap: true,
    rollupOptions: {
      output: {
        // Split heavyweight third-party libs into their own chunks. Browsers
        // can cache them independently of our app code, and changes in our
        // own source don't invalidate them.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('pdfjs-dist')) return 'vendor-pdfjs';
            if (id.includes('@codemirror') || id.includes('codemirror')) return 'vendor-codemirror';
            if (id.includes('katex')) return 'vendor-katex';
            if (id.includes('marked')) return 'vendor-marked';
            if (id.includes('react') || id.includes('zustand')) return 'vendor-react';
          }
          return undefined;
        },
      },
    },
    // The pdfjs/codemirror vendor chunks are legitimately large but lazy-loaded
    // (see the dynamic imports in App.tsx), so a big single chunk is expected —
    // raise the limit so vite stops nagging about a non-issue.
    chunkSizeWarningLimit: 2500,
  },
});
