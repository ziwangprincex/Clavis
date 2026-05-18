// Sidebar — collapsible panel container with 4 sections:
// Outline, Folder Tree, Project Files (LaTeX), Bibliography (LaTeX).

import { useState, type ReactNode } from 'react';
import styles from './Sidebar.module.css';

export interface SidebarProps {
  outline?: ReactNode;
  folderTree?: ReactNode;
  files?: ReactNode;
  bibliography?: ReactNode;
  /** Pixel width of the sidebar. Falls back to 260 when not specified. */
  width?: number;
}

export function Sidebar(props: SidebarProps) {
  const widthStyle = props.width
    ? { flex: `0 0 ${props.width}px`, width: `${props.width}px` }
    : undefined;

  return (
    <aside className={styles.sidebar} aria-label="Sidebar" style={widthStyle}>
      {props.outline && (
        <SidebarSection title="Outline" defaultOpen>
          {props.outline}
        </SidebarSection>
      )}
      {props.folderTree && (
        <SidebarSection title="Folder">
          {props.folderTree}
        </SidebarSection>
      )}
      {props.files && (
        <SidebarSection title="Project files">
          {props.files}
        </SidebarSection>
      )}
      {props.bibliography && (
        <SidebarSection title="Bibliography">
          {props.bibliography}
        </SidebarSection>
      )}
    </aside>
  );
}

interface SectionProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

function SidebarSection({ title, defaultOpen = false, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={styles.section}>
      <button
        className={styles.sectionHeader}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className={styles.caret}>{open ? '▾' : '▸'}</span>
        <span className={styles.sectionTitle}>{title}</span>
      </button>
      {open && <div className={styles.sectionBody}>{children}</div>}
    </div>
  );
}
