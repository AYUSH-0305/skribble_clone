import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { Game, type GameCallbacks } from '../src/models/Game.js';
import { Player } from '../src/models/Player.js';
import { WordBank } from '../src/models/WordBank.js';
import { DEFAULT_SETTINGS, type RoomSettings, type RoundEndReason } from '../src/types/events.js';

interface RoundEndEvent {
  word: string;
  reason: RoundEndReason;
  drawerId: string;
  scores: { playerId: string; roundPoints: number; totalScore: number }[];
}

function harness(names: string[], settings: Partial<RoomSettings> = {}) {
  const players = new Map<string, Player>();
  names.forEach((n) => players.set(n, new Player(n, n, n))); // id = name = socketId

  const s: RoomSettings = { ...DEFAULT_SETTINGS, ...settings };
  const events = {
    options: new Map<string, string[]>(),
    word: new Map<string, string>(),
    roundEnds: [] as RoundEndEvent[],
    hints: [] as { mask: string; hintsRevealed: number }[],
    gameOver: null as { winnerId: string | null } | null,
    clears: 0,
  };

  const cb: GameCallbacks = {
    onStateChange: () => {},
    onRoundStart: () => {},
    onWordOptions: (drawerId, options) => events.options.set(drawerId, options),
    onWordReveal: (drawerId, word) => events.word.set(drawerId, word),
    onDrawingStarted: () => {},
    onHintUpdate: (d) => events.hints.push(d),
    onRoundEnd: (d) => events.roundEnds.push(d),
    onGameOver: (d) => (events.gameOver = d),
    onClearCanvas: () => events.clears++,
  };

  const game = new Game(players, s, new WordBank(), cb);
  return { game, players, events, settings: s };
}

type Harness = ReturnType<typeof harness>;

/** Start the game and enter the drawing phase with the first drawer's first word. */
function startDrawing(h: Harness) {
  h.game.startGame();
  const drawerId = h.game.drawerId!;
  const opts = h.events.options.get(drawerId)!;
  h.game.chooseWord(drawerId, opts[0]);
  const word = h.events.word.get(drawerId)!;
  const guessers = [...h.players.keys()].filter((id) => id !== drawerId);
  return { drawerId, word, guessers };
}

describe('Game FSM', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('startGame enters choosing with a drawer and word options', () => {
    const h = harness(['a', 'b', 'c']);
    h.game.startGame();
    expect(h.game.phase).toBe('choosing');
    expect(h.game.round).toBe(1);
    expect(h.game.turnOrder).toHaveLength(3);
    expect(h.game.drawerId).toBeTruthy();
    expect(h.events.options.get(h.game.drawerId!)).toHaveLength(DEFAULT_SETTINGS.wordCount);
  });

  it('needs at least 2 players to start', () => {
    const h = harness(['solo']);
    h.game.startGame();
    expect(h.game.phase).toBe('lobby');
  });

  it('chooseWord enters drawing and sets an authoritative deadline', () => {
    const h = harness(['a', 'b'], { drawTime: 80 });
    const { word } = startDrawing(h);
    expect(h.game.phase).toBe('drawing');
    expect(h.game.currentWord).toBe(word);
    expect(h.game.roundEndsAt).toBe(80_000);
  });

  it('scores guessers by rank + time, and the drawer by participation share', () => {
    const h = harness(['a', 'b', 'c', 'd'], { drawTime: 80, hints: 0 });
    const { drawerId, word, guessers } = startDrawing(h);

    // All three guess at t=0 (full time remaining), in order.
    const r = guessers.map((id) => h.game.submitGuess(h.players.get(id)!, word));

    // base 300/260/220 + full time bonus 100 = 400/360/320
    expect(r[0].points).toBe(400);
    expect(r[1].points).toBe(360);
    expect(r[2].points).toBe(320);
    expect(r[0].points! > r[1].points! && r[1].points! > r[2].points!).toBe(true);

    // all guessed -> round ended exactly once
    expect(h.events.roundEnds).toHaveLength(1);
    const drawerRow = h.events.roundEnds[0].scores.find((x) => x.playerId === drawerId)!;
    // round((400+360+320)/3 * 0.7) = round(360*0.7) = 252
    expect(drawerRow.roundPoints).toBe(252);
    expect(drawerRow.roundPoints).toBeLessThan(r[0].points!);
  });

  it('reduces a guesser score as time elapses', () => {
    const h = harness(['a', 'b'], { drawTime: 80, hints: 0 });
    const { word, guessers } = startDrawing(h);
    vi.setSystemTime(40_000); // half the draw time gone
    const res = h.game.submitGuess(h.players.get(guessers[0])!, word);
    // rank-1 base 300 + round(0.5 * 100) = 350
    expect(res.points).toBe(350);
  });

  it('ends the round early once everyone has guessed', () => {
    const h = harness(['a', 'b', 'c'], { drawTime: 80, hints: 0 });
    const { word, guessers } = startDrawing(h);
    h.game.submitGuess(h.players.get(guessers[0])!, word);
    expect(h.game.phase).toBe('drawing');
    h.game.submitGuess(h.players.get(guessers[1])!, word);
    expect(h.game.phase).toBe('roundEnd');
    expect(h.events.roundEnds[0].reason).toBe('allGuessed');
  });

  it('ends on timeout and awards the drawer nothing when nobody guesses', () => {
    const h = harness(['a', 'b'], { drawTime: 15, hints: 0 });
    const { drawerId } = startDrawing(h);
    vi.advanceTimersByTime(16_000);
    expect(h.game.phase).toBe('roundEnd');
    expect(h.events.roundEnds[0].reason).toBe('timeout');
    const drawerRow = h.events.roundEnds[0].scores.find((x) => x.playerId === drawerId)!;
    expect(drawerRow.roundPoints).toBe(0);
  });

  it('rotates turns across the roster and ends after the last round', () => {
    const h = harness(['a', 'b'], { rounds: 1, drawTime: 15, hints: 0 });

    // Turn 1
    const t1 = startDrawing(h);
    h.game.submitGuess(h.players.get(t1.guessers[0])!, t1.word);
    expect(h.game.phase).toBe('roundEnd');
    vi.advanceTimersByTime(5_000); // advance to next turn

    // Turn 2 (the other player draws)
    expect(h.game.phase).toBe('choosing');
    const drawer2 = h.game.drawerId!;
    expect(drawer2).not.toBe(t1.drawerId);
    h.game.chooseWord(drawer2, h.events.options.get(drawer2)![0]);
    const word2 = h.events.word.get(drawer2)!;
    const guesser2 = [...h.players.keys()].find((id) => id !== drawer2)!;
    h.game.submitGuess(h.players.get(guesser2)!, word2);
    vi.advanceTimersByTime(5_000); // advance past the last turn

    expect(h.game.phase).toBe('gameOver');
    expect(h.events.gameOver).toBeTruthy();
  });

  it('rejects guesses from the drawer and repeat guesses from a solved player', () => {
    const h = harness(['a', 'b', 'c']);
    const { drawerId, word, guessers } = startDrawing(h);

    expect(h.game.submitGuess(h.players.get(drawerId)!, word).correct).toBe(false);

    const g = guessers[0];
    expect(h.game.submitGuess(h.players.get(g)!, word).correct).toBe(true);
    expect(h.game.submitGuess(h.players.get(g)!, word).correct).toBe(false);
  });

  it('flags an edit-distance-1 near miss as "close" without scoring', () => {
    const h = harness(['a', 'b', 'c']);
    h.game.startGame();
    const drawerId = h.game.drawerId!;
    const longWord = h.events.options.get(drawerId)!.find((w) => w.length > 3)!;
    h.game.chooseWord(drawerId, longWord);
    const guesser = [...h.players.keys()].find((id) => id !== drawerId)!;

    const near = longWord.slice(0, -1) + (longWord.endsWith('x') ? 'q' : 'x');
    const res = h.game.submitGuess(h.players.get(guesser)!, near);
    expect(res.correct).toBe(false);
    expect(res.close).toBe(true);
  });

  it('ends the round when the drawer leaves mid-turn', () => {
    const h = harness(['a', 'b', 'c'], { drawTime: 80 });
    const { drawerId } = startDrawing(h);
    h.players.delete(drawerId); // Room deletes before notifying Game
    h.game.handlePlayerLeft(drawerId);
    expect(h.events.roundEnds.some((r) => r.reason === 'drawerLeft')).toBe(true);
  });

  it('ends the game if too few players remain', () => {
    const h = harness(['a', 'b'], { drawTime: 80 });
    const { drawerId } = startDrawing(h);
    h.players.delete(drawerId);
    h.game.handlePlayerLeft(drawerId);
    expect(h.game.phase).toBe('gameOver');
  });

  it('reveals progressive hints over the draw time', () => {
    const h = harness(['a', 'b'], { drawTime: 20, hints: 2 });
    startDrawing(h);
    vi.advanceTimersByTime(20_000); // whole round
    expect(h.events.hints.length).toBeGreaterThan(0);
    // never reveals more than the configured number of hints
    const maxRevealed = Math.max(...h.events.hints.map((x) => x.hintsRevealed));
    expect(maxRevealed).toBeLessThanOrEqual(2);
  });
});
