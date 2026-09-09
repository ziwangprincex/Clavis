import { t } from '../i18n';
import { useId, useRef, useState, type ReactNode } from 'react';
import { IconChevronDown } from './icons';
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
  width?: number;
  hidden?: boolean;
}

const VIEWS = [
  { id: 'documents', label: 'Document' },
  { id: 'research', label: 'Research' },
  { id: 'review', label: 'Review' },
] as const;
type View = typeof VIEWS[number]['id'];

export function Sidebar(props: SidebarProps) {
  const [view, setView] = useState<View>('documents');
  const id = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const widthStyle = props.width ? { flex: `0 0 ${props.width}px`, width: `${props.width}px` } : undefined;

  return (
    <aside className={styles.sidebar} aria-label={t("Workspace")} hidden={props.hidden} style={widthStyle}>
      <div className={styles.heading}>{t("Workspace")}</div>
      <div className={styles.views} role="tablist" aria-label={t("Workspace views")}>
        {VIEWS.map((item, index) => (
          <button key={item.id} ref={element => { buttons.current[index] = element; }} role="tab"
            id={`${id}-${item.id}-tab`} aria-controls={`${id}-${item.id}`} aria-selected={view === item.id}
            tabIndex={view === item.id ? 0 : -1} className={`${styles.view} ${view === item.id ? styles.selected : ''}`}
            onClick={() => setView(item.id)} onKeyDown={event => {
              let next: number;
              if (event.key === 'ArrowRight') next = (index + 1) % VIEWS.length;
              else if (event.key === 'ArrowLeft') next = (index + VIEWS.length - 1) % VIEWS.length;
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = VIEWS.length - 1;
              else return;
              event.preventDefault();
              setView(VIEWS[next].id);
              buttons.current[next]?.focus();
            }}>{t(item.label)}</button>
        ))}
      </div>
      <div className={styles.content}>
        <div role="tabpanel" id={`${id}-documents`} aria-labelledby={`${id}-documents-tab`} hidden={view !== 'documents'} tabIndex={0}>
          {props.folderTree && <SidebarSection title={t("Files")} defaultOpen>{props.folderTree}</SidebarSection>}
          {props.outline && <SidebarSection title={t("Outline")} defaultOpen>{props.outline}</SidebarSection>}
          {props.files && <SidebarSection title={t("Project files")}>{props.files}</SidebarSection>}
        </div>
        <div role="tabpanel" id={`${id}-research`} aria-labelledby={`${id}-research-tab`} hidden={view !== 'research'} tabIndex={0}>
          {props.bibliography && <SidebarSection title={t("Bibliography")} defaultOpen>{props.bibliography}</SidebarSection>}
          {props.references && <SidebarSection title={t("References")} defaultOpen>{props.references}</SidebarSection>}
          {props.assets && <SidebarSection title={t("Assets")} defaultOpen>{props.assets}</SidebarSection>}
          {!props.bibliography && !props.references && !props.assets && <p className={styles.empty}>{t("Open a folder to browse your bibliography, references and assets.")}</p>}
        </div>
        <div role="tabpanel" id={`${id}-review`} aria-labelledby={`${id}-review-tab`} hidden={view !== 'review'} tabIndex={0}>
          {props.writing && <SidebarSection title={t("Writing checks")} defaultOpen>{props.writing}</SidebarSection>}
          {props.artifacts && <SidebarSection title={t("Build outputs")} defaultOpen>{props.artifacts}</SidebarSection>}
          {props.git && <SidebarSection title={t("Version control")} defaultOpen>{props.git}</SidebarSection>}
          {!props.writing && !props.artifacts && !props.git && <p className={styles.empty}>{t("Open a document or folder to review writing, build outputs and changes.")}</p>}
        </div>
      </div>
    </aside>
  );
}

function SidebarSection({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className={styles.section}>
      <button className={styles.sectionHeader} onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls={id}>
        <span className={styles.sectionTitle}>{t(title)}</span>
        <IconChevronDown size={12} aria-hidden="true" className={`${styles.caret} ${open ? styles.caretOpen : ''}`} />
      </button>
      <div id={id} className={styles.sectionBody} hidden={!open}>{children}</div>
    </section>
  );
}
