import { describe, expect, it } from 'vitest';
import { detectDocumentLanguage, documentLanguageLabel, isQuartoDocument } from './documentIdentity';

describe('Quarto document identity', () => {
  it('keeps qmd on the Markdown editor language but labels its flavor', () => {
    expect(detectDocumentLanguage('paper.qmd')).toBe('markdown');
    expect(isQuartoDocument('paper.QMD')).toBe(true);
    expect(documentLanguageLabel('paper.qmd', 'markdown')).toBe('Quarto');
  });
});
