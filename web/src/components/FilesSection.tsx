// FilesSection — list of subfiles in an active LaTeX project (or sibling
// files for Markdown/Typst). Driven by useProjectStore.

import { useProjectStore } from '../store';
import styles from './FilesSection.module.css';

export interface FilesSectionProps {
  onFileActivate?: (absPath: string) => void;
}

export function FilesSection({ onFileActivate }: FilesSectionProps) {
  const files = useProjectStore(s => s.files);
  const activeAbs = useProjectStore(s => s.activeAbs);
  const rootAbs = useProjectStore(s => s.rootAbs);

  if (!rootAbs) {
    return <div className={styles.empty}>(no project)</div>;
  }
  if (files.length === 0) {
    return <div className={styles.empty}>(no project files)</div>;
  }

  return (
    <ul className={styles.list}>
      {files.map(f => (
        <li
          key={f.absPath}
          className={`${styles.row} ${f.absPath === activeAbs ? styles.active : ''}`}
          onClick={() => onFileActivate?.(f.absPath)}
          title={f.absPath}
        >
          <span className={styles.relPath}>{f.relPath}</span>
          {f.isBib && <span className={styles.badge}>bib</span>}
        </li>
      ))}
    </ul>
  );
}
