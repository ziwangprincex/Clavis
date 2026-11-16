// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EditorController } from './controller';
import { BUILTIN_THEMES } from '../theme/themes';
import { useSettingsStore } from '../store/settings';

let controller: EditorController | null = null;
afterEach(() => { controller?.destroy(); controller = null; });

function mountEditor() {
  const parent = document.createElement('div');
  document.body.append(parent);
  controller = new EditorController({
    parent,
    initialDoc: 'Hello',
    lang: 'markdown',
    font: { family: 'serif', size: 16, lineHeight: 1.6 },
    theme: BUILTIN_THEMES.paper,
    spellcheck: false,
  });
  return controller;
}

describe('editor accessible name', () => {
  // Regression: the label sat on a role-less wrapper, which screen readers
  // ignore, so the text area itself was announced without a name.
  it('names the text area itself, in the interface language', () => {
    const editor = mountEditor();
    // As EditorPane does: the setting changes, then the editor is told.
    const switchTo = (language: 'en' | 'zh-CN') => {
      useSettingsStore.getState().patch({ ui_language: language });
      editor.setLocale(language);
    };
    switchTo('en');
    expect(editor.view.contentDOM.getAttribute('aria-label')).toBe('Document editor');
    switchTo('zh-CN');
    expect(editor.view.contentDOM.getAttribute('aria-label')).toBe('文档编辑器');
  });
});
