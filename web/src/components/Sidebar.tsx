import { t } from '../i18n';
import { useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { IconAlert, IconBook, IconChevronDown, IconDoc, IconFolder } from './icons';
import styles from './Sidebar.module.css';

export type SidebarView = 'documents' | 'research' | 'problems';

export interface SidebarProps {
  outline?: ReactNode;
  folderTree?: ReactNode;
  files?: ReactNode;
  bibliography?: ReactNode;
  references?: ReactNode;
  assets?: ReactNode;
  writing?: ReactNode;
  /** Compile problems and raw log. The Problems view exists only when this is set. */
  problems?: ReactNode;
  /** Marks the Problems tab when it is not selected. */
  problemCount?: number;
  /** Controlled view. When omitted the sidebar keeps its own selection. */
  view?: SidebarView;
  onViewChange?: (view: SidebarView) => void;
  onOpenFolder?: () => void;
  width?: number;
  hidden?: boolean;
}
const VIEWS = [
  { id: 'documents', label: 'Document', icon: IconDoc },
  { id: 'research', label: 'Research', icon: IconBook },
  { id: 'problems', label: 'Problems', icon: IconAlert },
] as const satisfies ReadonlyArray<{ id: SidebarView; label: string; icon: typeof IconDoc }>;

export function Sidebar(props: SidebarProps) {
  const [ownView, setOwnView] = useState<SidebarView>('documents');
  const view = props.view ?? ownView;
  const setView = (next: SidebarView) => { setOwnView(next); props.onViewChange?.(next); };
  const id = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const views = VIEWS.filter(item => item.id !== 'problems' || props.problems);
  const selected = views.some(item => item.id === view) ? view : 'documents';
  const hasResearch = props.bibliography || props.references || props.assets;
  const widthStyle = props.width
    ? { flex: `0 0 ${props.width}px`, width: `${props.width}px`, '--sidebar-width': `${props.width}px` } as CSSProperties
    : undefined;
  return (
    <aside className={styles.sidebar} aria-label={t('Workspace')} hidden={props.hidden} style={widthStyle}>
      <div className={styles.views} role="tablist" aria-label={t('Workspace views')}>
        {views.map((item, index) => (
          <button type="button" key={item.id} ref={element => { buttons.current[index] = element; }} role="tab"
            id={`${id}-${item.id}-tab`} aria-controls={`${id}-${item.id}`} aria-selected={selected === item.id}
            aria-label={t(item.label)} title={t(item.label)}
            tabIndex={selected === item.id ? 0 : -1} className={`${styles.view} ${selected === item.id ? styles.selected : ''}`}
            onClick={() => setView(item.id)} onKeyDown={event => {
              let next: number;
              if (event.key === 'ArrowRight') next = (index + 1) % views.length;
              else if (event.key === 'ArrowLeft') next = (index + views.length - 1) % views.length;
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = views.length - 1;
              else return;
              event.preventDefault();
              setView(views[next].id);
              buttons.current[next]?.focus();
            }}><item.icon size={16} aria-hidden="true" />
            {item.id === 'problems' && selected !== 'problems' && (props.problemCount ?? 0) > 0 && <span className={styles.badge} aria-hidden="true" />}
          </button>
        ))}
      </div>
      <div className={styles.content}>
        <div role="tabpanel" id={`${id}-documents`} aria-labelledby={`${id}-documents-tab`} hidden={selected !== 'documents'} tabIndex={0}>
          {props.folderTree}
          {props.outline}
          {props.files && <SidebarSection title={t('Included files')}>{props.files}</SidebarSection>}
          {props.writing && <SidebarSection title={t('Writing checks')}>{props.writing}</SidebarSection>}
        </div>
        <div role="tabpanel" id={`${id}-research`} aria-labelledby={`${id}-research-tab`} hidden={selected !== 'research'} tabIndex={0}>
          {props.bibliography && <SidebarSection title={t('Bibliography')} defaultOpen>{props.bibliography}</SidebarSection>}
          {props.references && <SidebarSection title={t('References')} defaultOpen>{props.references}</SidebarSection>}
          {props.assets && <SidebarSection title={t('Assets')}>{props.assets}</SidebarSection>}
          {!hasResearch && <div className={styles.empty}>
            <p>{t('Open a folder to browse its bibliography, references and assets.')}</p>
            {props.onOpenFolder && <button type="button" className={styles.openFolder} onClick={props.onOpenFolder}>
              <IconFolder size={14} aria-hidden="true" />{t('Open folder')}
            </button>}
          </div>}
        </div>
        {props.problems && <div role="tabpanel" id={`${id}-problems`} aria-labelledby={`${id}-problems-tab`} hidden={selected !== 'problems'} tabIndex={0} className={styles.fill}>
          {selected === 'problems' && !props.hidden && props.problems}
        </div>}
      </div>
    </aside>
  );
}

export function SidebarSection({ title, defaultOpen = false, actions, children }: { title: string; defaultOpen?: boolean; actions?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return <section className={styles.section}>
    <div className={styles.sectionHead}>
      <button type="button" className={styles.sectionHeader} onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls={id}>
        <IconChevronDown size={12} aria-hidden="true" className={`${styles.caret} ${open ? styles.caretOpen : ''}`} />
        <span className={styles.sectionTitle}>{title}</span>
      </button>
      {open && actions && <div className={styles.sectionActions}>{actions}</div>}
    </div>
    <div id={id} className={styles.sectionBody} hidden={!open}>{children}</div>
  </section>;
}
