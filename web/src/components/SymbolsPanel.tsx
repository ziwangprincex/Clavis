// SymbolsPanel — floating math-symbol palette. Click a symbol to insert
// the LaTeX/Typst command at the editor cursor. Filterable by typing.

import { useEffect, useMemo, useRef, useState } from 'react';
import { SYMBOL_GROUPS, symbolInsertText, type Symbol } from '../symbols/symbols';
import type { Lang } from '../store';
import styles from './SymbolsPanel.module.css';

export interface SymbolsPanelProps {
  open: boolean;
  lang: Lang;
  onClose: () => void;
  onInsert: (text: string) => void;
}

export function SymbolsPanel({ open, lang, onClose, onInsert }: SymbolsPanelProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SYMBOL_GROUPS;
    return SYMBOL_GROUPS.map(g => ({
      ...g,
      items: g.items.filter(
        s => s.l.toLowerCase().includes(q) || s.c.includes(query) || (s.t ?? '').toLowerCase().includes(q),
      ),
    })).filter(g => g.items.length > 0);
  }, [query]);

  if (!open) return null;

  function pick(s: Symbol) {
    onInsert(symbolInsertText(s, lang));
  }

  return (
    <div className={styles.panel} role="dialog" aria-label="Math symbols">
      <div className={styles.header}>
        <span className={styles.title}>Math symbols ({lang})</span>
        <input
          ref={inputRef}
          className={styles.filter}
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') onClose();
          }}
          placeholder="filter…"
        />
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className={styles.body}>
        {groups.length === 0 ? (
          <div className={styles.empty}>No matches</div>
        ) : (
          groups.map(g => (
            <section key={g.name} className={styles.group}>
              <h4 className={styles.groupTitle}>{g.name}</h4>
              <div className={styles.grid}>
                {g.items.map((s, i) => (
                  <button
                    key={`${g.name}-${i}`}
                    className={styles.cell}
                    title={`${lang === 'typst' ? s.t ?? s.l : '\\' + s.l}`}
                    onClick={() => pick(s)}
                  >
                    <span className={styles.glyph}>{s.c}</span>
                    <span className={styles.cmd}>
                      {lang === 'typst' ? s.t ?? s.l : s.l}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
