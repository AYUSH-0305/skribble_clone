import { describe, it, expect } from 'vitest';
import { normalize, levenshtein } from '../src/models/Game.js';
import { WordBank } from '../src/models/WordBank.js';

describe('normalize', () => {
  it('trims, lowercases, and collapses whitespace', () => {
    expect(normalize('  Hello ')).toBe('hello');
    expect(normalize('ICE   CREAM')).toBe('ice cream');
    expect(normalize('Café')).toBe('café');
  });
});

describe('levenshtein', () => {
  it('computes edit distance', () => {
    expect(levenshtein('cat', 'cat')).toBe(0);
    expect(levenshtein('cat', 'bat')).toBe(1); // substitution
    expect(levenshtein('cat', 'cats')).toBe(1); // insertion
    expect(levenshtein('cats', 'cat')).toBe(1); // deletion
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
  });
});

describe('WordBank', () => {
  const bank = new WordBank();

  it('masks a word with underscores, preserving spaces', () => {
    expect(WordBank.mask('cat')).toBe('_ _ _');
    expect(WordBank.mask('ice cream')).toContain('_');
    // "ice cream" -> letters masked, the space becomes a wider gap
    expect(WordBank.mask('ab cd').replace(/ /g, '').replace(/_/g, '')).toBe('');
  });

  it('reveals exactly N letters as hints', () => {
    const word = 'elephant';
    const masked = WordBank.maskWithHints(word, 3);
    const revealed = masked.split(' ').filter((ch) => ch !== '_' && ch !== '').length;
    expect(revealed).toBe(3);
    // never reveals more than the word length
    const all = WordBank.maskWithHints(word, 999);
    expect(all.split(' ').filter((c) => c === '_').length).toBe(0);
  });

  it('picks N distinct options', () => {
    const opts = bank.pickOptions(3);
    expect(opts).toHaveLength(3);
    expect(new Set(opts).size).toBe(3);
  });
});
