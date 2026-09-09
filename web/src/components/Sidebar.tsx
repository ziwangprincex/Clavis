import { t } from '../i18n';
import { useId, useRef, useState, type ReactNode } from 'react';
import { IconBook, IconChevronDown, IconDoc, IconFolder } from './icons';
import styles from './Sidebar.module.css';

export interface SidebarProps {
  outline?: ReactNode;
  folderTree?: ReactNode;
  files?: ReactNode;
  bibliography?: ReactNode;
  references?: ReactNode;
  artifacts?: ReactNode;
  assets?: ReactNode;
  writing?: ReactNode;
  git?: ReactNode;
  onOpenFolder?: () => void;
  width?: number;
  hidden?: boolean;
}
const VIEWS = [
  { id: 'documents', label: 'Document', icon: IconDoc },
  { id: 'research', label: 'Research', icon: IconBook },
  { id: 'project', label: 'Project', icon: IconFolder },
] as const;
type View = typeof VIEWS[number]['id'];

export function Sidebar(props: SidebarProps) {
  const [view, setView] = useState<View>('documents');
  const id = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const views = VIEWS.filter(item => item.id !== 'project' || props.artifacts || props.git);
  const selected = views.some(item => item.id === view) ? view : 'documents';
  const hasResearch = props.bibliography || props.references || props.assets;
  const widthStyle = props.width ? { flex: `0 0 ${props.width}px`, width: `${props.width}px` } : undefined;
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
            }}><item.icon size={16} aria-hidden="true" /></button>
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
            <p>{t('Open a folder to browse your bibliography, references and assets.')}</p>
            {props.onOpenFolder && <button type="button" className={styles.openFolder} onClick={props.onOpenFolder}>
              <IconFolder size={14} aria-hidden="true" />{t('Open folder')}
            </button>}
          </div>}
        </div>
        {views.some(item => item.id === 'project') && <div role="tabpanel" id={`${id}-project`} aria-labelledby={`${id}-project-tab`} hidden={selected !== 'project'} tabIndex={0}>
          {props.artifacts && <SidebarSection title={t('Build outputs')}>{props.artifacts}</SidebarSection>}
          {props.git && <SidebarSection title={t('Version control')}>{props.git}</SidebarSection>}
        </div>}
      </div>
    </aside>
  );
}

export function SidebarSection({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return <section className={styles.section}>
    <button type="button" className={styles.sectionHeader} onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls={id}>
      <IconChevronDown size={12} aria-hidden="true" className={`${styles.caret} ${open ? styles.caretOpen : ''}`} />
      <span className={styles.sectionTitle}>{title}</span>
    </button>
    <div id={id} className={styles.sectionBody} hidden={!open}>{children}</div>
  </section>;
}
