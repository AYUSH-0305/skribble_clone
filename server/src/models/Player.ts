import type { PlayerView } from '../types/events.js';

/**
 * A participant in a room. Pure data plus a couple of small helpers.
 * Never touches sockets directly.
 */
export class Player {
  id: string; // socket.id
  name: string;
  score = 0;
  isHost = false;

  // Per-round state
  hasGuessedThisRound = false;
  guessedAt: number | null = null; // epoch ms of correct guess (for score decay)
  guessOrder: number | null = null; // 1st, 2nd, ... correct guesser this round

  connected = true;

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
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
