import { useEffect, useMemo, useState } from 'react';
import type { Lang } from '../store';
import { parseDelimitedTable, renderTable, type TableFormat } from '../tables/delimited';
import styles from './TableConvertDialog.module.css';

export interface TableConvertDialogProps {
  open: boolean;
  lang: Lang;
  onClose: () => void;
  onInsert: (text: string) => void;
}

function defaultFormat(lang: Lang): TableFormat {
  return lang === 'latex' ? 'latex' : lang === 'typst' ? 'typst' : 'markdown';
}

export function TableConvertDialog({ open, lang, onClose, onInsert }: TableConvertDialogProps) {
  const [input, setInput] = useState('');
  const [format, setFormat] = useState<TableFormat>(defaultFormat(lang));
  const [hasHeader, setHasHeader] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFormat(defaultFormat(lang));
    setError(null);
  }, [open, lang]);

  const preview = useMemo(() => {
    if (!input.trim()) return { text: '', error: null as string | null };
    try {
      return { text: renderTable(parseDelimitedTable(input), { format, hasHeader }), error: null as string | null };
    } catch (reason) {
      return { text: '', error: String(reason) };
    }
  }, [input, format, hasHeader]);

  function insert() {
    try {
      const table = parseDelimitedTable(input);
      onInsert(renderTable(table, { format, hasHeader }));
      onClose();
    } catch (reason) {
      setError(String(reason));
    }
  }

  if (!open) return null;
  return (
    <div className={styles.backdrop} onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-label="Convert delimited table">
        <header className={styles.header}>
          <div><h2>Convert CSV / TSV Table</h2><p>Paste a delimited table. Quoted CSV cells, tabs, and ragged rows are supported.</p></div>
          <button type="button" onClick={onClose}>Close</button>
        </header>
        <div className={styles.options}>
          <label>Output<select value={format} onChange={event => setFormat(event.target.value as TableFormat)}><option value="markdown">Markdown / Quarto</option><option value="latex">LaTeX booktabs</option><option value="typst">Typst #table</option></select></label>
          <label className={styles.check}><input type="checkbox" checked={hasHeader} onChange={event => setHasHeader(event.target.checked)} /> First row is a header</label>
        </div>
        <div className={styles.body}>
          <label>Input<textarea autoFocus value={input} onChange={event => { setInput(event.target.value); setError(null); }} placeholder={'Variable\tEstimate\nMinimum wage\t0.12'} /></label>
          <label>Preview<pre>{preview.text || (input.trim() ? 'Fix input to preview.' : 'Paste CSV or TSV to preview.')}</pre></label>
        </div>
        {(error ?? preview.error) && <div className={styles.error}>{error ?? preview.error}</div>}
        <footer><button type="button" disabled={!input.trim()} onClick={insert}>Insert Table</button></footer>
      </section>
    </div>
  );
}
