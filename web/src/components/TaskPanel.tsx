import { useTaskStore } from '../store';
import styles from './TaskPanel.module.css';

export function TaskPanel() {
  const runId = useTaskStore(s => s.runId);
  const requestedTask = useTaskStore(s => s.requestedTask);
  const activeTask = useTaskStore(s => s.activeTask);
  const status = useTaskStore(s => s.status);
  const plan = useTaskStore(s => s.plan);
  const lines = useTaskStore(s => s.lines);
  const cancel = useTaskStore(s => s.cancel);
  const clear = useTaskStore(s => s.clear);

  return (
    <div className={styles.root} data-run-id={runId ?? undefined}>
      <header className={styles.header}>
        <span className={styles.title}>Project Task</span>
        <strong>{requestedTask ?? 'Task output'}</strong>
        <span className={`${styles.badge} ${styles[status]}`}>{status}</span>
        {activeTask && <span className={styles.active}>running {activeTask}</span>}
        <span className={styles.spacer} />
        {status === 'running' ? (
          <button type="button" className={styles.stop} onClick={() => void cancel()}>
            Stop
          </button>
        ) : (
          <button type="button" className={styles.clear} onClick={clear}>
            Close
          </button>
        )}
      </header>
      {plan.length > 0 && (
        <div className={styles.plan} title="Dependency execution order">
          {plan.map((task, index) => (
            <span key={task} className={task === activeTask ? styles.planActive : undefined}>
              {index > 0 && <span className={styles.arrow}>→</span>}
              {task}
            </span>
          ))}
        </div>
      )}
      <pre className={styles.output} aria-live="polite">
        {lines.length === 0 ? (
          <span className={styles.muted}>Waiting for output…</span>
        ) : (
          lines.map((line, index) => (
            <span key={index} className={styles[`stream-${line.stream}`]}>
              <span className={styles.prefix}>[{line.task}]</span> {line.text}{'\n'}
            </span>
          ))
        )}
      </pre>
    </div>
  );
}
