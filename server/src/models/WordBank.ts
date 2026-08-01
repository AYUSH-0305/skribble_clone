import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const wordData: Record<string, string[]> = require('../data/words.json');

/**
 * Stateless source of words. Loads the categorized word list once, then serves
 * random options and produces masks/hints for the guessing UI.
 */
export class WordBank {
  private readonly all: string[];
  private readonly byCategory: Record<string, string[]>;

  constructor() {
    this.byCategory = wordData;
    this.all = Object.values(wordData).flat();
  }

  /** N distinct random words for the drawer to choose from. */
  pickOptions(n: number): string[] {
    const pool = [...this.all];
    const out: string[] = [];
    const count = Math.min(n, pool.length);
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      out.push(pool.splice(idx, 1)[0]);
    }
    return out;
  }

  /**
   * Fully masked form of a word. Letters -> "_", spaces preserved as a wider gap.
   * "ice cream" -> "_ _ _   _ _ _ _ _"
   */
  static mask(word: string): string {
    return word
      .split('')
      .map((ch) => (ch === ' ' ? '  ' : '_'))
      .join(' ');
  }

  /**
   * Reveal `revealCount` letters of `word`, keeping the rest masked. Which
   * positions are revealed is deterministic given the word + count so all
   * clients agree (server is authoritative anyway, but this keeps it stable).
   */
  static maskWithHints(word: string, revealCount: number): string {
    const letterPositions = word
      .split('')
      .map((ch, i) => (ch === ' ' ? -1 : i))
      .filter((i) => i >= 0);

    // Deterministic pseudo-random pick based on word content.
    const revealed = new Set<number>();
    let seed = 0;
    for (const ch of word) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const shuffled = [...letterPositions].sort((a, b) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const ra = seed;
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return ra - seed + (a - b) * 0;
    });
    for (let i = 0; i < Math.min(revealCount, shuffled.length); i++) {
      revealed.add(shuffled[i]);
    }

    return word
      .split('')
      .map((ch, i) => {
        if (ch === ' ') return '  ';
        return revealed.has(i) ? ch : '_';
      })
      .join(' ');
  }

  get categories(): string[] {
    return Object.keys(this.byCategory);
  }
}
