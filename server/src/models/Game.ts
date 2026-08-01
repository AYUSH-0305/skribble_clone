import type {
  GamePhase,
  GameStateView,
  RoomSettings,
  RoundEndReason,
  ScoreDelta,
} from '../types/events.js';
import { Player } from './Player.js';
import { WordBank } from './WordBank.js';

// ---------------------------------------------------------------------------
// Scoring — modelled on skribbl.io, kept on a deliberately moderate, bounded
// scale so totals don't balloon.
//
//   A guesser's score is driven mainly by TIME remaining, modified by RANK:
//     timeScore = GUESS_MIN + timeFraction × (GUESS_MAX − GUESS_MIN)   // 20..200
//     rankMult  = max(RANK_FLOOR, 1 − (rank−1) × RANK_FALLOFF)         // 1.0, 0.9, ...
//     score     = round(timeScore × rankMult)                          // floored at GUESS_MIN
//
//   The drawer earns a share of the participation-weighted average guesser
//   score, so a clear drawing many people guess quickly is rewarded — but the
//   drawer never out-earns the fastest guesser. Nobody guesses => nobody scores.
// ---------------------------------------------------------------------------
const GUESS_MAX = 200; // score for an instant first guess (upper bound)
const GUESS_MIN = 20; // floor for guessing correctly at all
const RANK_FALLOFF = 0.1; // each later guesser keeps 10% less of their time score
const RANK_FLOOR = 0.5; // ...but never less than half
const DRAWER_SHARE = 0.5; // drawer's cut of the average guesser score

const CHOOSE_TIME_MS = 15_000; // drawer auto-pick fallback
const ROUND_END_PAUSE_MS = 5_000; // reveal word before next turn

/**
 * Domain events the Game raises. Room implements these to translate them into
 * Socket.IO broadcasts. Game itself never imports socket.io — it is pure logic
 * and fully unit-testable.
 */
export interface GameCallbacks {
  onStateChange(): void;
  onRoundStart(data: { drawerId: string; drawerName: string; round: number }): void;
  onWordOptions(drawerId: string, options: string[]): void;
  onWordReveal(drawerId: string, word: string): void;
  onDrawingStarted(data: { mask: string; roundEndsAt: number; wordLength: number }): void;
  onHintUpdate(data: { mask: string; hintsRevealed: number }): void;
  onRoundEnd(data: {
    word: string;
    reason: RoundEndReason;
    drawerId: string;
    scores: ScoreDelta[];
  }): void;
  onGameOver(data: { winnerId: string | null }): void;
  onClearCanvas(): void;
}

/**
 * The finite state machine that runs one game inside a Room.
 * lobby -> choosing -> drawing -> roundEnd -> (loop) -> gameOver
 */
export class Game {
  phase: GamePhase = 'lobby';
  round = 0;
  turnOrder: string[] = []; // player ids
  turnIndex = 0;

  currentWord: string | null = null;
  currentMask: string | null = null;
  hintsRevealed = 0;
  roundEndsAt: number | null = null;

  private wordOptions: string[] = [];
  private tickTimer: NodeJS.Timeout | null = null;
  private chooseTimer: NodeJS.Timeout | null = null;
  private advanceTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly players: Map<string, Player>,
    private readonly settings: RoomSettings,
    private readonly wordBank: WordBank,
    private readonly cb: GameCallbacks
  ) {}

  get drawerId(): string | null {
    return this.turnOrder[this.turnIndex] ?? null;
  }

  private get connectedPlayers(): Player[] {
    return [...this.players.values()].filter((p) => p.connected);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  startGame(): void {
    const ids = this.connectedPlayers.map((p) => p.id);
    if (ids.length < 2) return;
    // Randomize draw order once per game.
    this.turnOrder = ids.sort(() => Math.random() - 0.5);
    this.turnIndex = 0;
    this.round = 1;
    for (const p of this.players.values()) p.score = 0;
    this.beginTurn();
  }

  private beginTurn(): void {
    this.clearTimers();
    this.phase = 'choosing';
    this.currentWord = null;
    this.currentMask = null;
    this.hintsRevealed = 0;
    this.roundEndsAt = null;
    for (const p of this.players.values()) p.resetRound();
    this.cb.onClearCanvas();

    const drawer = this.drawerId ? this.players.get(this.drawerId) : null;
    if (!drawer) {
      // Drawer vanished between turns — skip ahead.
      this.advanceTurn();
      return;
    }

    this.wordOptions = this.wordBank.pickOptions(this.settings.wordCount);
    this.cb.onRoundStart({ drawerId: drawer.id, drawerName: drawer.name, round: this.round });
    this.cb.onWordOptions(drawer.id, this.wordOptions);
    this.cb.onStateChange();

    // Auto-pick if the drawer dithers.
    this.chooseTimer = setTimeout(() => {
      if (this.phase === 'choosing') {
        this.chooseWord(this.drawerId!, this.wordOptions[0]);
      }
    }, CHOOSE_TIME_MS);
  }

  chooseWord(playerId: string, word: string): void {
    if (this.phase !== 'choosing') return;
    if (playerId !== this.drawerId) return;
    if (!this.wordOptions.includes(word)) return;

    if (this.chooseTimer) {
      clearTimeout(this.chooseTimer);
      this.chooseTimer = null;
    }

    this.phase = 'drawing';
    this.currentWord = word;
    this.currentMask = WordBank.mask(word);
    this.hintsRevealed = 0;
    this.roundEndsAt = Date.now() + this.settings.drawTime * 1000;

    this.cb.onWordReveal(playerId, word); // targeted: only drawer sees the word
    this.cb.onDrawingStarted({
      mask: this.currentMask,
      roundEndsAt: this.roundEndsAt,
      wordLength: word.length,
    });
    this.cb.onStateChange();

    this.tickTimer = setInterval(() => this.tick(), 1000);
  }

  private tick(): void {
    if (this.phase !== 'drawing' || this.roundEndsAt == null) return;
    const now = Date.now();

    // Progressive hint reveals, spread across the draw time.
    if (this.settings.hints > 0 && this.currentWord) {
      const total = this.settings.drawTime * 1000;
      const elapsed = total - (this.roundEndsAt - now);
      const step = total / (this.settings.hints + 1);
      const due = Math.min(this.settings.hints, Math.floor(elapsed / step));
      if (due > this.hintsRevealed) {
        this.hintsRevealed = due;
        this.currentMask = WordBank.maskWithHints(this.currentWord, this.hintsRevealed);
        this.cb.onHintUpdate({ mask: this.currentMask, hintsRevealed: this.hintsRevealed });
        this.cb.onStateChange();
      }
    }

    if (now >= this.roundEndsAt) {
      this.endRound('timeout');
    }
  }

  // -------------------------------------------------------------------------
  // Guessing
  // -------------------------------------------------------------------------

  /** Returns the outcome of a guess without mutating chat — Room handles messaging. */
  submitGuess(
    player: Player,
    text: string
  ): { correct: boolean; close: boolean; points?: number; order?: number } {
    if (this.phase !== 'drawing' || !this.currentWord) return { correct: false, close: false };
    if (player.id === this.drawerId) return { correct: false, close: false };
    if (player.hasGuessedThisRound) return { correct: false, close: false };

    const guess = normalize(text);
    const answer = normalize(this.currentWord);

    if (guess === answer) {
      const order = this.connectedPlayers.filter((p) => p.hasGuessedThisRound).length + 1;
      const points = this.computeGuessScore(order);
      player.hasGuessedThisRound = true;
      player.guessedAt = Date.now();
      player.guessOrder = order;
      player.score += points;
      this.roundPointsCache.set(player.id, points);

      if (this.allGuessed()) {
        this.endRound('allGuessed');
      } else {
        this.cb.onStateChange();
      }
      return { correct: true, close: false, points, order };
    }

    // "Close" if within edit distance 1 (and word is long enough to matter).
    const close = answer.length > 3 && levenshtein(guess, answer) <= 1;
    return { correct: false, close };
  }

  /**
   * A correct guesser's score: time-driven, reduced a little per rank.
   * `rank` is 1 for the first correct guesser, 2 for the next, and so on.
   */
  private computeGuessScore(rank: number): number {
    const timeLeftMs = this.roundEndsAt == null ? 0 : Math.max(0, this.roundEndsAt - Date.now());
    const timeFrac = Math.min(1, timeLeftMs / (this.settings.drawTime * 1000));
    const timeScore = GUESS_MIN + timeFrac * (GUESS_MAX - GUESS_MIN);
    const rankMult = Math.max(RANK_FLOOR, 1 - (rank - 1) * RANK_FALLOFF);
    return Math.max(GUESS_MIN, Math.round(timeScore * rankMult));
  }

  private allGuessed(): boolean {
    const guessers = this.connectedPlayers.filter((p) => p.id !== this.drawerId);
    return guessers.length > 0 && guessers.every((p) => p.hasGuessedThisRound);
  }

  // -------------------------------------------------------------------------
  // Round / turn advance
  // -------------------------------------------------------------------------

  private endRound(reason: RoundEndReason): void {
    if (this.phase === 'roundEnd' || this.phase === 'gameOver') return;
    this.clearTimers();
    this.phase = 'roundEnd';

    const word = this.currentWord ?? '';
    const drawer = this.drawerId ? this.players.get(this.drawerId) : null;

    // Drawer earns a share of the participation-weighted average guesser score:
    //   (sum of correct guessers' points / eligible guessers) * DRAWER_SHARE.
    // More people guessing (and faster) => bigger drawer reward, but always
    // below the fastest guesser. Nobody guessed => drawer scores nothing.
    const guessers = this.connectedPlayers.filter((p) => p.id !== this.drawerId);
    const correct = guessers.filter((p) => p.hasGuessedThisRound);
    if (drawer && guessers.length > 0 && correct.length > 0) {
      const sum = correct.reduce((s, p) => s + this.pointsEarnedBy(p), 0);
      const drawerPoints = Math.round((sum / guessers.length) * DRAWER_SHARE);
      drawer.score += drawerPoints;
      this.roundPointsCache.set(drawer.id, drawerPoints);
    }

    const scores: ScoreDelta[] = this.connectedPlayers.map((p) => ({
      playerId: p.id,
      playerName: p.name,
      roundPoints: this.pointsEarnedBy(p),
      totalScore: p.score,
    }));

    this.cb.onRoundEnd({ word, reason, drawerId: drawer?.id ?? '', scores });
    this.cb.onStateChange();

    this.advanceTimer = setTimeout(() => this.advanceTurn(), ROUND_END_PAUSE_MS);
  }

  // Per-round points, recorded live as they are earned, so round_end reports
  // accurate deltas for both guessers and the drawer.
  private roundPointsCache = new Map<string, number>();

  /** Points a player earned this round (0 if none). */
  private pointsEarnedBy(p: Player): number {
    return this.roundPointsCache.get(p.id) ?? 0;
  }

  private advanceTurn(): void {
    this.roundPointsCache.clear();
    this.turnIndex++;
    if (this.turnIndex >= this.turnOrder.length) {
      this.turnIndex = 0;
      this.round++;
      if (this.round > this.settings.rounds) {
        this.gameOver();
        return;
      }
    }
    this.beginTurn();
  }

  private gameOver(): void {
    this.clearTimers();
    this.phase = 'gameOver';
    const ranked = [...this.players.values()].sort((a, b) => b.score - a.score);
    this.cb.onGameOver({ winnerId: ranked[0]?.id ?? null });
    this.cb.onStateChange();
  }

  // -------------------------------------------------------------------------
  // External events from Room
  // -------------------------------------------------------------------------

  handlePlayerLeft(playerId: string): void {
    const leavingIndex = this.turnOrder.indexOf(playerId);
    const wasDrawer = playerId === this.drawerId;
    if (leavingIndex >= 0) {
      this.turnOrder.splice(leavingIndex, 1);
      if (leavingIndex < this.turnIndex) this.turnIndex--;
    }
    if (this.phase === 'gameOver' || this.phase === 'lobby') return;

    if (this.connectedPlayers.length < 2) {
      // Not enough players to continue — fall back to game over.
      this.gameOver();
      return;
    }
    if (wasDrawer && (this.phase === 'choosing' || this.phase === 'drawing')) {
      // Drawer bailed mid-turn; the pointer already advanced by the splice, so
      // step back one and let advanceTurn move to the right next drawer.
      this.turnIndex--;
      this.endRound('drawerLeft');
    }
  }

  // -------------------------------------------------------------------------
  // State snapshot
  // -------------------------------------------------------------------------

  toStateView(playersView: GameStateView['players']): GameStateView {
    const drawer = this.drawerId ? this.players.get(this.drawerId) : null;
    return {
      phase: this.phase,
      round: this.round,
      totalRounds: this.settings.rounds,
      drawerId: this.drawerId,
      drawerName: drawer?.name ?? null,
      mask: this.currentMask,
      wordLength: this.currentWord?.length ?? null,
      hintsRevealed: this.hintsRevealed,
      roundEndsAt: this.roundEndsAt,
      players: playersView,
      settings: this.settings,
    };
  }

  clearTimers(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.chooseTimer) clearTimeout(this.chooseTimer);
    if (this.advanceTimer) clearTimeout(this.advanceTimer);
    this.tickTimer = this.chooseTimer = this.advanceTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}
