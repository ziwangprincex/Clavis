// Math symbol palette data — ported from ui-legacy/symbols.js.

import type { Lang } from '../store';

export interface Symbol {
  /** Preview character (Unicode). */
  c: string;
  /** LaTeX command (without leading backslash; we'll add it on insert). */
  l: string;
  /** Typst expression (omit if same as LaTeX with $...$ wrapping). */
  t?: string;
}

export interface SymbolGroup {
  name: string;
  items: Symbol[];
}

export const SYMBOL_GROUPS: SymbolGroup[] = [
  {
    name: 'Greek lowercase',
    items: [
      { c: 'α', l: 'alpha' }, { c: 'β', l: 'beta' }, { c: 'γ', l: 'gamma' },
      { c: 'δ', l: 'delta' }, { c: 'ε', l: 'varepsilon' }, { c: 'ζ', l: 'zeta' },
      { c: 'η', l: 'eta' }, { c: 'θ', l: 'theta' }, { c: 'ι', l: 'iota' },
      { c: 'κ', l: 'kappa' }, { c: 'λ', l: 'lambda' }, { c: 'μ', l: 'mu' },
      { c: 'ν', l: 'nu' }, { c: 'ξ', l: 'xi' }, { c: 'π', l: 'pi' },
      { c: 'ρ', l: 'rho' }, { c: 'σ', l: 'sigma' }, { c: 'τ', l: 'tau' },
      { c: 'υ', l: 'upsilon' }, { c: 'φ', l: 'varphi' }, { c: 'χ', l: 'chi' },
      { c: 'ψ', l: 'psi' }, { c: 'ω', l: 'omega' },
    ],
  },
  {
    name: 'Greek uppercase',
    items: [
      { c: 'Γ', l: 'Gamma' }, { c: 'Δ', l: 'Delta' }, { c: 'Θ', l: 'Theta' },
      { c: 'Λ', l: 'Lambda' }, { c: 'Ξ', l: 'Xi' }, { c: 'Π', l: 'Pi' },
      { c: 'Σ', l: 'Sigma' }, { c: 'Υ', l: 'Upsilon' }, { c: 'Φ', l: 'Phi' },
      { c: 'Ψ', l: 'Psi' }, { c: 'Ω', l: 'Omega' },
    ],
  },
  {
    name: 'Operators',
    items: [
      { c: '∫', l: 'int', t: 'integral' },
      { c: '∬', l: 'iint', t: 'integral.double' },
      { c: '∮', l: 'oint', t: 'integral.cont' },
      { c: '∑', l: 'sum' },
      { c: '∏', l: 'prod', t: 'product' },
      { c: '∂', l: 'partial' },
      { c: '∇', l: 'nabla' },
      { c: '√', l: 'sqrt{}', t: 'sqrt()' },
      { c: '∞', l: 'infty', t: 'infinity' },
      { c: '±', l: 'pm', t: 'plus.minus' },
      { c: '∓', l: 'mp', t: 'minus.plus' },
      { c: '×', l: 'times' },
      { c: '÷', l: 'div', t: 'div' },
      { c: '·', l: 'cdot', t: 'dot.c' },
      { c: '⋅', l: 'cdot', t: 'dot.c' },
      { c: '⊗', l: 'otimes', t: 'times.circle' },
      { c: '⊕', l: 'oplus', t: 'plus.circle' },
    ],
  },
  {
    name: 'Relations',
    items: [
      { c: '=', l: '=' },
      { c: '≠', l: 'neq', t: 'eq.not' },
      { c: '≈', l: 'approx', t: 'approx' },
      { c: '≡', l: 'equiv', t: 'equiv' },
      { c: '∼', l: 'sim', t: 'tilde.op' },
      { c: '<', l: '<' },
      { c: '>', l: '>' },
      { c: '≤', l: 'leq', t: 'lt.eq' },
      { c: '≥', l: 'geq', t: 'gt.eq' },
      { c: '≪', l: 'll', t: 'lt.double' },
      { c: '≫', l: 'gg', t: 'gt.double' },
      { c: '∝', l: 'propto', t: 'prop' },
      { c: '∈', l: 'in', t: 'in' },
      { c: '∉', l: 'notin', t: 'in.not' },
      { c: '⊂', l: 'subset', t: 'subset' },
      { c: '⊆', l: 'subseteq', t: 'subset.eq' },
      { c: '⊃', l: 'supset', t: 'supset' },
      { c: '⊇', l: 'supseteq', t: 'supset.eq' },
    ],
  },
  {
    name: 'Arrows',
    items: [
      { c: '→', l: 'to', t: 'arrow' },
      { c: '←', l: 'gets', t: 'arrow.l' },
      { c: '↔', l: 'leftrightarrow', t: 'arrow.l.r' },
      { c: '⇒', l: 'Rightarrow', t: 'arrow.r.double' },
      { c: '⇐', l: 'Leftarrow', t: 'arrow.l.double' },
      { c: '⇔', l: 'Leftrightarrow', t: 'arrow.l.r.double' },
      { c: '↑', l: 'uparrow', t: 'arrow.t' },
      { c: '↓', l: 'downarrow', t: 'arrow.b' },
      { c: '↦', l: 'mapsto', t: 'arrow.r.bar' },
    ],
  },
  {
    name: 'Logic & sets',
    items: [
      { c: '∀', l: 'forall', t: 'forall' },
      { c: '∃', l: 'exists', t: 'exists' },
      { c: '∄', l: 'nexists', t: 'exists.not' },
      { c: '∧', l: 'wedge', t: 'and' },
      { c: '∨', l: 'vee', t: 'or' },
      { c: '¬', l: 'neg', t: 'not' },
      { c: '∅', l: 'emptyset', t: 'emptyset' },
      { c: '∪', l: 'cup', t: 'union' },
      { c: '∩', l: 'cap', t: 'sect' },
      { c: 'ℝ', l: 'mathbb{R}', t: 'RR' },
      { c: 'ℕ', l: 'mathbb{N}', t: 'NN' },
      { c: 'ℤ', l: 'mathbb{Z}', t: 'ZZ' },
      { c: 'ℚ', l: 'mathbb{Q}', t: 'QQ' },
      { c: 'ℂ', l: 'mathbb{C}', t: 'CC' },
    ],
  },
  {
    name: 'Brackets & misc',
    items: [
      { c: '⟨ ⟩', l: 'langle\\rangle', t: 'angle.l angle.r' },
      { c: '⌊ ⌋', l: 'lfloor\\rfloor', t: 'floor.l floor.r' },
      { c: '⌈ ⌉', l: 'lceil\\rceil', t: 'ceil.l ceil.r' },
      { c: '∥', l: 'parallel', t: 'parallel' },
      { c: '∠', l: 'angle', t: 'angle' },
      { c: '°', l: 'circ', t: 'degree' },
      { c: 'ℵ', l: 'aleph', t: 'aleph' },
      { c: 'ℏ', l: 'hbar', t: 'planck.reduce' },
      { c: 'ℓ', l: 'ell', t: 'ell' },
    ],
  },
];

/** Build the snippet text for a given symbol in the current language. */
export function symbolInsertText(sym: Symbol, lang: Lang): string {
  if (lang === 'typst') {
    return sym.t || sym.l;
  }
  // LaTeX / Markdown
  return '\\' + sym.l;
}
