import type { PlayerView } from '../types/events.js';

/**
 * A participant in a room. Pure data plus a couple of small helpers.
 * Never touches sockets directly.
 *
 * `id` is a STABLE session token that survives reconnects; `socketId` is the
 * currently-attached socket and is updated whenever the player reconnects.
 */
export class Player {
  id: string; // stable session token
  socketId: string; // current socket.id (changes on reconnect)
  name: string;
  score = 0;
  isHost = false;

  // Per-round state
  hasGuessedThisRound = false;
  guessedAt: number | null = null; // epoch ms of correct guess (for score decay)
  guessOrder: number | null = null; // 1st, 2nd, ... correct guesser this round

  connected = true;
  disconnectedAt: number | null = null;

  constructor(id: string, name: string, socketId: string) {
    this.id = id;
    this.name = name;
    this.socketId = socketId;
  }

  resetRound(): void {
    this.hasGuessedThisRound = false;
    this.guessedAt = null;
    this.guessOrder = null;
  }

  toView(): PlayerView {
    return {
      id: this.id,
      name: this.name,
      score: this.score,
      isHost: this.isHost,
      hasGuessedThisRound: this.hasGuessedThisRound,
      connected: this.connected,
    };
  }
}
