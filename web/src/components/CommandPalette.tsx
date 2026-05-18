import { useEffect, useMemo, useRef, useState } from 'react';
import { useCommandsStore, type Command } from '../store/commands';
import styles from './CommandPalette.module.css';

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const list = useCommandsStore(s => s.list);
  const commandsMap = useCommandsStore(s => s.commands); // dependency for memo
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo<Command[]>(() => {
    const q = query.toLowerCase().trim();
    const all = list();
    return q ? all.filter(c => c.name.toLowerCase().includes(q)) : all;
    // Re-run when commandsMap identity changes (a register/unregister occurred).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, commandsMap]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  if (!open) return null;

  function exec(cmd?: Command) {
    if (!cmd) return;
    onClose();
    Promise.resolve(cmd.run()).catch(err => {
      console.error('Command failed:', cmd.id, err);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      exec(filtered[activeIdx]);
    }
  }

  return (
    <div
      className={styles.backdrop}
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.palette} role="dialog" aria-label="Command Palette">
        <input
          ref={inputRef}
          className={styles.input}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a command…"
          aria-label="Command query"
        />
        <ul className={styles.list}>
          {filtered.length === 0 ? (
            <li className={styles.empty}>No matching commands</li>
          ) : (
            filtered.map((cmd, i) => (
              <li
                key={cmd.id}
                className={`${styles.item} ${i === activeIdx ? styles.active : ''}`}
                onMouseEnter={() => setActiveIdx(i)}
                onMouseDown={e => {
                  e.preventDefault(); // prevent input blur before click
                  exec(cmd);
                }}
              >
                <span className={styles.name}>{cmd.name}</span>
                {cmd.shortcut && <span className={styles.shortcut}>{cmd.shortcut}</span>}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
