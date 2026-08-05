// Workspace bibliography browser: rich metadata, ranked multi-token search,
// project citation frequency, recent history, multi-select insertion, and an
// optional local Better BibTeX export refresh loop.

import { useEffect, useMemo, useState } from 'react';
import { ipc, type BibEntry, type BibliographyExportStatus } from '../api/tauri';
import { useProjectStore, useReferencesStore, useSettingsStore } from '../store';
import { indexBibliography, rankBibliography } from '../bibliography/rank';
import styles from './BibSection.module.css';

export interface BibSectionProps {
  onInsertCites?: (keys: string[]) => void;
  onJumpToSource?: (absPath: string, line: number) => void;
  onExportChanged?: () => void;
}

const MAX_VISIBLE = 200;
const RECENT_CITATIONS_LIMIT = 50;

export function BibSection({ onInsertCites, onJumpToSource, onExportChanged }: BibSectionProps) {
  const files = useProjectStore(s => s.files);
  const workspace = useProjectStore(s => s.workspace);
  const indexedOccurrences = useReferencesStore(s => s.result?.occurrences ?? []);
  const recentKeys = useSettingsStore(s => s.settings.recent_citations);
  const patchAndSave = useSettingsStore(s => s.patchAndSave);
  const [entries, setEntries] = useState<BibEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exports, setExports] = useState<BibliographyExportStatus[]>([]);
  const [exportRevision, setExportRevision] = useState(0);

  const bibPaths = useMemo(() => [...new Set([
    ...files.filter(file => file.isBib).map(file => file.absPath),
    ...indexedOccurrences.filter(item => item.language === 'bibtex' && item.role === 'definition').map(item => item.path),
    ...exports.filter(item => item.exists).map(item => item.path),
  ])], [files, indexedOccurrences, exports]);
  const signature = bibPaths.join('|');

  useEffect(() => {
    if (bibPaths.length === 0) { setEntries([]); return; }
    let cancelled = false;
    ipc.parseBib(bibPaths).then(
      list => { if (!cancelled) { setEntries(list); setError(null); setSelected(current => new Set([...current].filter(key => list.some(entry => entry.key === key)))); } },
      reason => { if (!cancelled) { setEntries([]); setError(String(reason)); } },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, exportRevision]);

  useEffect(() => {
    if (!workspace?.root || workspace.config?.bibliography?.provider !== 'better-bibtex') { setExports([]); return; }
    let cancelled = false;
    let previous = '';
    const poll = async () => {
      try {
        const next = await ipc.inspectBibliographyExports(workspace.root);
        const nextSignature = next.map(item => `${item.path}:${item.sizeBytes ?? -1}:${item.modifiedMillis ?? -1}`).join('|');
        if (!cancelled) {
          setExports(next);
          if (previous && previous !== nextSignature) {
            setExportRevision(value => value + 1);
            onExportChanged?.();
          }
          previous = nextSignature;
        }
      } catch { /* Project Doctor surfaces config errors. */ }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [workspace, onExportChanged]);

  useEffect(() => { const timer = window.setTimeout(() => setSearchQuery(filter), 120); return () => window.clearTimeout(timer); }, [filter]);

  const indexedEntries = useMemo(() => indexBibliography(entries), [entries]);
  const usageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of indexedOccurrences) if (item.namespace === 'citation' && item.role === 'usage') counts.set(item.key, (counts.get(item.key) ?? 0) + 1);
    return counts;
  }, [indexedOccurrences]);
  const ranked = useMemo(() => rankBibliography(indexedEntries, searchQuery, usageCounts, recentKeys), [indexedEntries, searchQuery, usageCounts, recentKeys]);
  const visible = ranked.slice(0, MAX_VISIBLE);
  const hidden = Math.max(0, ranked.length - MAX_VISIBLE);

  async function insert(keys: string[]) {
    const unique = [...new Set(keys)].filter(Boolean);
    if (unique.length === 0) return;
    onInsertCites?.(unique);
    await patchAndSave({ recent_citations: [...unique, ...recentKeys.filter(key => !unique.includes(key))].slice(0, RECENT_CITATIONS_LIMIT) });
    setSelected(new Set());
  }
  function toggle(key: string) { setSelected(current => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; }); }

  if (bibPaths.length === 0) return <div className={styles.empty}>(no .bib files in workspace)</div>;
  return <div className={styles.root}>
    <div className={styles.searchRow}><input className={styles.filter} type="search" value={filter} onChange={event => setFilter(event.target.value)} placeholder="author title year key DOI…" /><button type="button" className={styles.insertBtn} disabled={selected.size === 0} onClick={() => void insert([...selected])}>Insert {selected.size || ''}</button></div>
    {error && <div className={styles.error}>{error}</div>}
    {!error && entries.length === 0 ? <div className={styles.empty}>(no bibliography entries)</div> : <>
      <div className={styles.summary}>{ranked.length} entries · {indexedOccurrences.filter(item => item.namespace === 'citation' && item.role === 'usage').length} project citations</div>
      {exports.length > 0 && <div className={styles.exportStatus}>{exports.map(item => item.exists ? `${item.provider}: ${item.relativePath}` : `missing export: ${item.relativePath}`).join(' · ')}</div>}
      <ul className={styles.list}>{visible.map(({ entry, usageCount, recentRank }) => {
        const checked = selected.has(entry.key); const venue = entry.journal ?? entry.booktitle ?? entry.publisher;
        return <li key={`${entry.sourceFile}:${entry.key}`} className={`${styles.item} ${checked ? styles.selected : ''}`}>
          <div className={styles.main}><input aria-label={`Select ${entry.key}`} type="checkbox" checked={checked} onChange={() => toggle(entry.key)} /><button type="button" className={styles.content} onDoubleClick={() => void insert([entry.key])}>
            <span className={styles.topline}><span className={styles.key}>{entry.key}</span>{recentRank !== Number.MAX_SAFE_INTEGER && <span className={styles.badge}>recent</span>}{usageCount > 0 && <span className={styles.badge}>cited {usageCount}×</span>}</span>
            <span className={styles.title}>{entry.title ?? entry.entryType}</span><span className={styles.meta}>{[entry.author ?? entry.editor, entry.year, venue].filter(Boolean).join(' · ')}</span>
          </button></div>
          <div className={styles.actions}><button type="button" onClick={() => setExpanded(expanded === entry.key ? null : entry.key)}>{expanded === entry.key ? 'Less' : 'More'}</button>{onJumpToSource && <button type="button" onClick={() => onJumpToSource(entry.sourceFile, entry.sourceLine)}>Source</button>}</div>
          {expanded === entry.key && <div className={styles.details}>{entry.abstractText && <p>{entry.abstractText}</p>}<dl>{entry.doi && <><dt>DOI</dt><dd>{entry.doi}</dd></>}{entry.url && <><dt>URL</dt><dd>{entry.url}</dd></>}{entry.keywords.length > 0 && <><dt>Keywords</dt><dd>{entry.keywords.join(', ')}</dd></>}{(entry.volume || entry.number || entry.pages) && <><dt>Details</dt><dd>{[entry.volume && `vol. ${entry.volume}`, entry.number && `no. ${entry.number}`, entry.pages && `pp. ${entry.pages}`].filter(Boolean).join(' · ')}</dd></>}</dl></div>}
        </li>;
      })}{hidden > 0 && <li className={styles.empty}>… {hidden} more (refine search)</li>}</ul>
    </>}
  </div>;
}
