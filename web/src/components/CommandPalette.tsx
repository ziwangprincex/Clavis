import { t, useLocale } from '../i18n';
import { useModal } from '../hooks/useModal';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { shortcutLabel, useCommandsStore, type Command } from '../store/commands';
import styles from './CommandPalette.module.css';

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const locale = useLocale();
  const modal = useModal(open, onClose);
  const list = useCommandsStore(s => s.list);
  const commandsMap = useCommandsStore(s => s.commands); // dependency for memo
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const optionId = (index: number) => `${listId}-${index}`;
  // Where the pointer was when the list appeared. A list opening under a resting
  // pointer gets enter/move events with no movement, which must not select.
  const pointer = useRef<{ x: number; y: number } | null>(null);

  const filtered = useMemo<Command[]>(() => {
    const q = query.toLowerCase().trim();
    const all = list();
    return q ? all.filter(c => `${c.name} ${t(c.name)}`.toLowerCase().includes(q)) : all;
    // Re-run when commandsMap identity changes (a register/unregister occurred).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, commandsMap, locale]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      pointer.current = null;
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  // Arrowing past the visible rows keeps the active command in view.
  useEffect(() => {
    if (open && typeof document !== 'undefined') document.getElementById?.(optionId(activeIdx))?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  function hover(index: number, event: { clientX: number; clientY: number }) {
    const at = { x: event.clientX, y: event.clientY };
    if (!pointer.current) { pointer.current = at; return; }
    if (at.x === pointer.current.x && at.y === pointer.current.y) return;
    pointer.current = at;
    setActiveIdx(index);
  }

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
      <section {...modal} className={styles.palette} role="dialog" aria-label={t("Command Palette")}>
        <input
          ref={inputRef}
          className={styles.input}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("Type a command…")}
          aria-label={t("Command query")}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={true}
          aria-controls={listId}
          aria-activedescendant={filtered.length ? optionId(activeIdx) : undefined}
        />
        <ul className={styles.list} id={listId} role="listbox" aria-label={t("Commands")}>
          {filtered.length === 0 ? (
            <li className={styles.empty} role="option" aria-selected={false} aria-disabled={true}>{t("No matching commands")}</li>
          ) : (
            filtered.map((cmd, i) => (
              <li
                key={cmd.id}
                id={optionId(i)}
                role="option"
                aria-selected={i === activeIdx}
                className={`${styles.item} ${i === activeIdx ? styles.active : ''}`}
                onMouseMove={event => hover(i, event)}
                onMouseDown={e => {
                  e.preventDefault(); // prevent input blur before click
                  exec(cmd);
                }}
              >
                <span className={styles.name}>{t(cmd.name)}</span>
                {shortcutLabel(cmd) && <span className={styles.shortcut}>{shortcutLabel(cmd)}</span>}
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
