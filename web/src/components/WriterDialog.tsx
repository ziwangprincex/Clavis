import { useEffect, useRef, useState } from 'react';
import { createTemplate, dialogOpen, history, ipc, type EngineInfo, type LocalVersion } from '../api/tauri';
import { openFileByPath } from '../files/files';
import { retainLocalCopy } from '../files/documentSync';
import { newTabId, useTabsStore, type Tab } from '../store/tabs';
import { proseDiff } from '../git/proseDiff';
import styles from './WriterDialog.module.css';

export type WriterTool = 'templates' | 'history' | 'environment';
export function WriterDialog({ tool, onClose }: { tool: WriterTool; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const initial = useRef(
    useTabsStore.getState().tabs.find((t) => t.id === useTabsStore.getState().activeTabId),
  );
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    ref.current?.focus();
    return () => before?.focus();
  }, []);
  const title = {
    templates: 'Start with a clean page',
    history: 'Local version timeline',
    environment: 'Writing environment',
  }[tool];
  return (
    <div className={styles.backdrop}>
      <section
        ref={ref}
        tabIndex={-1}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape' && !busy) {
            event.preventDefault();
            onClose();
          }
          if (event.key === 'Tab') {
            const items = [
              ...ref.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea'),
            ];
            const first = items[0],
              last = items.at(-1);
            if (
              event.shiftKey &&
              (document.activeElement === first || document.activeElement === ref.current)
            ) {
              event.preventDefault();
              last?.focus();
            } else if (
              !event.shiftKey &&
              (document.activeElement === last || document.activeElement === ref.current)
            ) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header>
          <h2>{title}</h2>
          <button disabled={busy} onClick={onClose}>
            Close
          </button>
        </header>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <div className={styles.body}>
          {tool === 'templates' && <Templates busy={busy} run={run} onClose={onClose} />}
          {tool === 'environment' && <Environment />}
          {tool === 'history' && <Timeline tab={initial.current} busy={busy} run={run} onClose={onClose} />}
        </div>
      </section>
    </div>
  );
}
function Templates({
  busy,
  run,
  onClose,
}: {
  busy: boolean;
  run: (f: () => Promise<void>) => Promise<void>;
  onClose: () => void;
}) {
  const [template, setTemplate] = useState('typst-paper'),
    [name, setName] = useState('My paper');
  return (
    <>
      <p>Three offline starters. No package downloads, generated scripts or template marketplace.</p>
      <div className={styles.choices}>
        {[
          [
            'typst-paper',
            'Typst paper',
            'Built-in typesetter · article, sections, equation and cross-reference',
          ],
          ['latex-paper', 'LaTeX paper', 'Local TeX required · article + amsmath, split introduction'],
          ['research-note', 'Research note', 'Markdown · question, evidence and next step'],
        ].map(([id, title, description]) => (
          <button key={id} aria-pressed={template === id} onClick={() => setTemplate(id)}>
            <strong>{title}</strong>
            <span>{description}</span>
          </button>
        ))}
      </div>
      <label className={styles.field}>
        New project folder
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <button
        disabled={busy || !name.trim()}
        onClick={() =>
          void run(async () => {
            const parent = await dialogOpen({
              directory: true,
              title: 'Choose parent folder for the new project',
            });
            if (typeof parent !== 'string') return;
            const main = await createTemplate(parent, name, template);
            if (!(await openFileByPath(main)))
              throw new Error('Project created, but could not open its main document.');
            onClose();
          })
        }
      >
        Choose location and create…
      </button>
    </>
  );
}
function Environment() {
  const [engines, setEngines] = useState<EngineInfo[]>(),
    [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    Promise.all([ipc.detectLatexEngines(), ipc.detectBibEngines()]).then(
      ([a, b]) => {
        if (alive) setEngines([...a, ...b]);
      },
      (e) => {
        if (alive) setError(String(e));
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  return (
    <>
      <p>
        Typst and Markdown rendering are bundled and available offline. No external installation is needed for
        the Typst starter.
      </p>
      {error ? (
        <p role="alert">{error}</p>
      ) : !engines ? (
        <p>Checking local TeX tools…</p>
      ) : (
        engines.map((engine) => (
          <div className={styles.engine} key={engine.name}>
            <strong>{engine.name}</strong>
            <span>
              {engine.path
                ? `${engine.path}${engine.version ? ` · ${engine.version}` : ''}`
                : 'Not found. Install a TeX distribution or set its path in Settings → LaTeX.'}
            </span>
          </div>
        ))
      )}
      <p>
        Fonts and additional packages are project-specific. Their exact missing names appear in the
        compilation diagnostics. Nothing is installed automatically.
      </p>
    </>
  );
}
function Timeline({
  tab,
  busy,
  run,
  onClose,
}: {
  tab: Tab | undefined;
  busy: boolean;
  run: (f: () => Promise<void>) => Promise<void>;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<LocalVersion[]>([]),
    [selected, setSelected] = useState(''),
    [content, setContent] = useState<string | null>(null),
    [error, setError] = useState(''),
    [diff, setDiff] = useState(false);
  useEffect(() => {
    let alive = true;
    if (tab?.filePath)
      history.list(tab.filePath).then(
        (list) => {
          if (alive) setVersions(list);
        },
        (e) => {
          if (alive) setError(String(e));
        },
      );
    return () => {
      alive = false;
    };
  }, [tab?.filePath]);
  useEffect(() => {
    let alive = true;
    setContent(null);
    setError('');
    if (selected && tab?.filePath)
      history.read(tab.filePath, selected).then(
        (text) => {
          if (alive) setContent(text);
        },
        (e) => {
          if (alive) setError(String(e));
        },
      );
    return () => {
      alive = false;
    };
  }, [selected, tab?.filePath]);
  if (!tab?.filePath) return <p>Save the document once to start its local timeline.</p>;
  const path = tab.filePath;
  return (
    <>
      <p>{path}</p>
      <p>
        Previous disk contents are captured before each changed save. Keep up to 50 versions per document and
        256 MiB in total, independently of Git. Restoring changes only the editor buffer.
      </p>
      {error && <p role="alert">{error}</p>}
      <button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const live = useTabsStore.getState().tabs.find((t) => t.id === tab.id);
            if (!live) throw new Error('Document was closed');
            await history.checkpoint(path, live.content);
            setVersions(await history.list(path));
          })
        }
      >
        Create checkpoint
      </button>
      <div className={styles.timeline}>
        <div className={styles.versionList}>
          {!versions.length && <p>No saved versions yet.</p>}
          {versions.map((v) => (
            <button key={v.id} aria-pressed={v.id === selected} onClick={() => setSelected(v.id)}>
              <strong>{new Date(v.timestamp).toLocaleString()}</strong>
              <span>{Math.ceil(v.bytes / 1024)} KB</span>
            </button>
          ))}
        </div>
        <div className={styles.versionText}>
          <textarea
            aria-label="Historical version"
            readOnly
            value={content ?? 'Select a version to compare.'}
          />
          {content !== null && (
            <>
              <label>
                <input type="checkbox" checked={diff} onChange={(e) => setDiff(e.target.checked)} /> Show
                differences with current draft
              </label>
              {diff && (
                <pre>
                  {proseDiff(
                    content.slice(0, 12000),
                    (useTabsStore.getState().tabs.find((t) => t.id === tab.id)?.content ?? tab.content).slice(
                      0,
                      12000,
                    ),
                  ).map((chunk, i) => (
                    <span key={i} className={styles[chunk.kind]}>
                      {chunk.text}
                    </span>
                  ))}
                  {content.length > 12000 || tab.content.length > 12000
                    ? '\nDifference view limited to the first 12,000 characters; version above is complete.'
                    : ''}
                </pre>
              )}
            </>
          )}
        </div>
      </div>
      <footer>
        <button
          disabled={content === null || busy}
          onClick={() => {
            useTabsStore
              .getState()
              .addTab({
                id: newTabId(),
                title: `${tab.title} (historical copy)`,
                filePath: null,
                lang: tab.lang,
                content: content!,
                isDirty: true,
              });
            onClose();
          }}
        >
          Open as copy
        </button>
        <button
          disabled={content === null || busy}
          onClick={() =>
            void run(async () => {
              const current = useTabsStore.getState().tabs.find((t) => t.id === tab.id);
              if (!current || current.filePath !== path) throw new Error('Document was closed or moved');
              // Persist the current draft before restoration; disk conflict baseline stays unchanged.
              await history.checkpoint(path, current.content);
              const latest = useTabsStore.getState().tabs.find((t) => t.id === tab.id);
              if (!latest || latest.content !== current.content)
                throw new Error('Draft changed during checkpoint; review again');
              retainLocalCopy(latest);
              useTabsStore.getState().patchTab(tab.id, { content: content!, isDirty: true });
              useTabsStore.getState().setActive(tab.id);
              onClose();
            })
          }
        >
          Restore into editor
        </button>
      </footer>
    </>
  );
}
