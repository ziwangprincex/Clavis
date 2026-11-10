// The toolbar above a Markdown table being edited, as Typora's table tooltip:
// column alignment buttons, and menus to insert, move and delete rows and
// columns, copy the table or delete it.

import { StateField, type EditorState } from '@codemirror/state';
import { showTooltip, type Command, type EditorView, type Tooltip } from '@codemirror/view';
import { t } from '../i18n';
import {
  alignColumn, columnAlign, deleteColumn, deleteRow, deleteTable, formatTable, insertColumn, insertColumnLeft,
  insertRow, insertRowAbove, moveColumn, moveRow, tableAt, tableSource, type ColumnAlign,
} from './markdownEditing';

const icon = (path: string) => `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><path d="${path}"/></svg>`;
type TableAction = { label: string; run: Command; keys?: string };
type TableTool =
  | { label: string; path: string; run: Command; align?: ColumnAlign }
  | { label: string; path: string; menu: TableAction[] }
  | null;

const copyTable: Command = view => {
  const source = tableSource(view.state);
  if (source === null) return false;
  void navigator.clipboard?.writeText(source).catch(() => undefined);
  return true;
};

/** Typora's table toolbar: alignment, then row, column and table menus. */
const TABLE_TOOLS: TableTool[] = [
  { label: 'Align left', path: 'M2 3h10M2 6h7M2 9h10M2 12h6', run: alignColumn('left'), align: 'left' },
  { label: 'Align center', path: 'M2 3h10M3.5 6h7M2 9h10M4 12h6', run: alignColumn('center'), align: 'center' },
  { label: 'Align right', path: 'M2 3h10M5 6h7M2 9h10M6 12h6', run: alignColumn('right'), align: 'right' },
  null,
  { label: 'Row', path: 'M2 2.5h10v4H2zM2 9.5h10', menu: [
    { label: 'Insert row above', run: insertRowAbove },
    { label: 'Insert row below', run: insertRow, keys: 'Mod-Enter' },
    { label: 'Move row up', run: moveRow(-1), keys: 'Alt-Mod-ArrowUp' },
    { label: 'Move row down', run: moveRow(1), keys: 'Alt-Mod-ArrowDown' },
    { label: 'Delete row', run: deleteRow },
  ] },
  { label: 'Column', path: 'M2.5 2h4v10h-4zM9.5 2v10', menu: [
    { label: 'Insert column left', run: insertColumnLeft },
    { label: 'Insert column right', run: insertColumn },
    { label: 'Move column left', run: moveColumn(-1), keys: 'Alt-Mod-ArrowLeft' },
    { label: 'Move column right', run: moveColumn(1), keys: 'Alt-Mod-ArrowRight' },
    { label: 'Delete column', run: deleteColumn },
  ] },
  null,
  { label: 'Format table source', path: 'M2 4h10M2 7h10M2 10h10M5 2v10M9 2v10', run: formatTable },
  { label: 'More table actions', path: 'M3.5 7h.01M7 7h.01M10.5 7h.01', menu: [
    { label: 'Copy table as Markdown', run: copyTable },
    { label: 'Delete table', run: deleteTable },
  ] },
];

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const KEY_NAMES: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: '↩' };
function keyLabel(keys: string): string {
  const parts = keys.split('-');
  const key = KEY_NAMES[parts[parts.length - 1]] ?? parts[parts.length - 1];
  const mods = parts.slice(0, -1).map(mod => MAC ? ({ Alt: '⌥', Mod: '⌘', Shift: '⇧', Ctrl: '⌃' } as Record<string, string>)[mod] : ({ Alt: 'Alt+', Mod: 'Ctrl+', Shift: 'Shift+', Ctrl: 'Ctrl+' } as Record<string, string>)[mod]);
  return mods.join('') + key;
}

/** A small menu under `button`; closes on choice, Escape or a click elsewhere. */
function openTableMenu(view: EditorView, button: HTMLButtonElement, actions: TableAction[], host: HTMLElement) {
  host.querySelector('.cm-md-table-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'cm-md-table-menu';
  menu.setAttribute('role', 'menu');
  for (const action of actions) {
    const item = document.createElement('button');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.append(Object.assign(document.createElement('span'), { textContent: t(action.label) }));
    if (action.keys) item.append(Object.assign(document.createElement('kbd'), { textContent: keyLabel(action.keys) }));
    item.addEventListener('click', () => { close(); action.run(view); view.focus(); });
    menu.append(item);
  }
  menu.style.left = `${button.offsetLeft}px`;
  host.append(menu);
  button.setAttribute('aria-expanded', 'true');
  const outside = (event: MouseEvent) => { if (!menu.contains(event.target as Node) && event.target !== button) close(); };
  const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
  function close() {
    menu.remove();
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', outside, true);
    document.removeEventListener('keydown', escape, true);
  }
  document.addEventListener('mousedown', outside, true);
  document.addEventListener('keydown', escape, true);
}

function tableTools(pos: number): Tooltip {
  return {
    pos,
    above: true,
    arrow: false,
    create(view) {
      const dom = document.createElement('div');
      dom.className = 'cm-md-table-tools';
      dom.setAttribute('role', 'toolbar');
      dom.setAttribute('aria-label', t('Table tools'));
      // Keep the editor focused, or the table would be drawn again and the toolbar close.
      dom.addEventListener('mousedown', event => event.preventDefault());
      const aligns: { button: HTMLButtonElement; align: ColumnAlign }[] = [];
      for (const tool of TABLE_TOOLS) {
        if (!tool) {
          dom.append(Object.assign(document.createElement('span'), { className: 'cm-md-table-tools-gap' }));
          continue;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.title = t(tool.label);
        button.setAttribute('aria-label', t(tool.label));
        button.innerHTML = icon(tool.path);
        if ('menu' in tool) {
          button.classList.add('cm-md-table-tools-menu');
          button.setAttribute('aria-haspopup', 'menu');
          button.setAttribute('aria-expanded', 'false');
          button.insertAdjacentHTML('beforeend', '<svg width="7" height="7" viewBox="0 0 7 7" aria-hidden="true"><path d="M1 2.5l2.5 2.5 2.5-2.5" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>');
          button.addEventListener('click', () => {
            if (button.getAttribute('aria-expanded') === 'true') dom.querySelector('.cm-md-table-menu')?.remove();
            else openTableMenu(view, button, tool.menu, dom);
          });
        } else {
          button.addEventListener('click', () => { tool.run(view); view.focus(); });
          if (tool.align) aligns.push({ button, align: tool.align });
        }
        dom.append(button);
      }
      const sync = (state: EditorState) => {
        const align = columnAlign(state);
        for (const item of aligns) item.button.setAttribute('aria-pressed', String(item.align === align));
      };
      sync(view.state);
      return { dom, update: update => sync(update.state) };
    },
  };
}

/** Shown above a table while its source is being edited, when `editing` says the source is revealed. */
export function tableToolbar(editing: (state: EditorState) => boolean) {
  return StateField.define<Tooltip | null>({
    create: () => null,
    update(value, tr) {
      const head = tr.state.selection.main.head;
      const table = editing(tr.state) ? tableAt(tr.state, head) : null;
      const start = table ? tr.state.doc.line(table.first).from : null;
      if (start === null) return null;
      // The same tooltip object keeps its DOM while the cursor moves inside the table.
      return value?.pos === start ? value : tableTools(start);
    },
    provide: field => showTooltip.from(field),
  });
}
