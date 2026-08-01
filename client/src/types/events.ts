// ============================================================================
// SHARED WIRE CONTRACT  —  keep this file identical in server/ and client/
// ============================================================================
// This is the single source of truth for every Socket.IO event and payload.
// If it compiles on both sides, the client and server agree on the protocol.
// When you edit this file, copy it to the other package.
// ============================================================================

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type GamePhase = 'lobby' | 'choosing' | 'drawing' | 'roundEnd' | 'gameOver';

export type DrawTool = 'pen' | 'eraser';

export type WordMode = 'normal' | 'hidden' | 'combination';

export type RoundEndReason = 'timeout' | 'allGuessed' | 'drawerLeft';

export interface RoomSettings {
  maxPlayers: number; // 2–20
  rounds: number; // 2–10
  drawTime: number; // 15–240 (seconds)
  wordCount: number; // 1–5  (options shown to drawer)
  hints: number; // 0–5  (letters revealed over time)
  wordMode: WordMode;
}

export const DEFAULT_SETTINGS: RoomSettings = {
  maxPlayers: 8,
  rounds: 3,
  drawTime: 80,
  wordCount: 3,
  hints: 2,
  wordMode: 'normal',
};

export interface PlayerView {
  id: string;
  name: string;
  score: number;
  isHost: boolean;
  hasGuessedThisRound: boolean;
  connected: boolean;
}

export interface Point {
  x: number; // normalized 0..1
  y: number; // normalized 0..1
}

export interface Stroke {
  id: string;
  color: string;
  size: number; // normalized brush size (fraction of canvas width)
  tool: DrawTool;
  points: Point[];
}

export interface ScoreDelta {
  playerId: string;
  playerName: string;
  roundPoints: number;
  totalScore: number;
}

// ---------------------------------------------------------------------------
// The public game state broadcast to every client.
// NOTE: the plaintext `word` is deliberately NOT part of this. Only the drawer
// receives the word, via a targeted `word_reveal` event.
// ---------------------------------------------------------------------------
export interface GameStateView {
  phase: GamePhase;
  round: number;
  totalRounds: number;
  drawerId: string | null;
  drawerName: string | null;
  mask: string | null; // e.g. "_ _ a _"  (what guessers see)
  wordLength: number | null;
  hintsRevealed: number;
  roundEndsAt: number | null; // server epoch ms; clients render countdown
  players: PlayerView[];
  settings: RoomSettings;
}

// ---------------------------------------------------------------------------
// Client -> Server events
// ---------------------------------------------------------------------------
export interface ClientToServerEvents {
  create_room: (
    data: { hostName: string; settings?: Partial<RoomSettings>; isPrivate?: boolean },
    ack: (res: { ok: boolean; roomId?: string; you?: PlayerView; error?: string }) => void
  ) => void;

  join_room: (
    data: { roomId: string; playerName: string },
    ack: (res: {
      ok: boolean;
      you?: PlayerView;
      state?: GameStateView;
      strokes?: Stroke[];
      error?: string;
    }) => void
  ) => void;

  start_game: () => void;
  leave_room: () => void;
  request_canvas: () => void; // ask the server to (re)send the current canvas

  // Drawing (drawer only; server enforces)
  draw_start: (data: { x: number; y: number; color: string; size: number; tool: DrawTool }) => void;
  draw_move: (data: Point) => void;
  draw_end: () => void;
  canvas_clear: () => void;
  draw_undo: () => void;

  // Round
  word_chosen: (data: { word: string }) => void;

  // Chat & guessing
  guess: (data: { text: string }) => void;
  chat: (data: { text: string }) => void;

  // Reactions & moderation
  react: (data: { type: 'like' | 'dislike' }) => void;
  votekick: (data: { targetId: string }) => void;
}

// ---------------------------------------------------------------------------
// Server -> Client events
// ---------------------------------------------------------------------------
export interface ServerToClientEvents {
  // Room / lobby
  player_joined: (data: { player: PlayerView; players: PlayerView[] }) => void;
  player_left: (data: { playerId: string; players: PlayerView[]; newHostId?: string }) => void;

  // Reconnection: server restored this socket into its previous room, or told
  // it there was nothing to restore (e.g. the grace window expired).
  resumed: (data: { you: PlayerView; roomId: string; state: GameStateView }) => void;
  resume_failed: () => void;

  // The host left (or their grace window expired) — the room is gone and every
  // remaining player is returned to the home screen.
  room_closed: () => void;

  // Live like/dislike tallies for the current drawing.
  reactions: (data: { likes: number; dislikes: number }) => void;

  // This client was vote-kicked — return to home (and it's banned from the room).
  kicked: () => void;

  // Game state
  game_state: (state: GameStateView) => void;
  round_start: (data: { drawerId: string; drawerName: string; round: number }) => void;
  word_options: (data: { options: string[] }) => void; // targeted -> drawer
  word_reveal: (data: { word: string }) => void; // targeted -> drawer
  drawing_started: (data: { mask: string; roundEndsAt: number; wordLength: number }) => void;
  hint_update: (data: { mask: string; hintsRevealed: number }) => void;
  round_end: (data: {
    word: string;
    reason: RoundEndReason;
    drawerId: string;
    scores: ScoreDelta[];
  }) => void;
  game_over: (data: { winner: PlayerView | null; leaderboard: PlayerView[] }) => void;

  // Drawing
  draw_data: (data: { stroke: Stroke }) => void; // finalized stroke
  draw_point: (data: { strokeId: string; point: Point }) => void; // live streaming point
  canvas_clear: () => void;
  canvas_state: (data: { strokes: Stroke[] }) => void; // targeted replay to joiner

  // Chat & guessing
  guess_result: (data: {
    playerId: string;
    playerName: string;
    correct: boolean;
    points?: number;
    order?: number;
  }) => void;
  chat_message: (data: { playerId: string; playerName: string; text: string }) => void;
  system_message: (data: { text: string; kind?: 'info' | 'correct' | 'join' | 'leave' }) => void;

  error_message: (data: { message: string }) => void;
}
