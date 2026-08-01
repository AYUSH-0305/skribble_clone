import type { RoomSettings } from './types/events.js';
import { DEFAULT_SETTINGS } from './types/events.js';
import type { AppServer, AppSocket } from './types/socket.js';
import { Room } from './models/Room.js';
import { WordBank } from './models/WordBank.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars

// How long a disconnected player is kept in their room before being removed.
// This is what lets a phone survive backgrounding / brief network drops.
const GRACE_MS = 120_000;

function clamp(v: number, lo: number, hi: number, fallback: number): number {
  if (typeof v !== 'number' || Number.isNaN(v)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

/**
 * Top-level registry. Owns every Room and maps player tokens to their room.
 * Player identity is the stable session token (not the socket id), so a
 * reconnecting client is re-attached to the same Player instead of kicked.
 * All settings validation happens here — the server never trusts client numbers.
 */
export class GameServer {
  private readonly rooms = new Map<string, Room>();
  private readonly playerToRoom = new Map<string, string>(); // token -> roomId
  private readonly graceTimers = new Map<string, NodeJS.Timeout>(); // token -> removal timer
  private readonly wordBank = new WordBank();

  constructor(private readonly io: AppServer) {}

  static sanitizeSettings(input: Partial<RoomSettings> | undefined): RoomSettings {
    const s = input ?? {};
    const mode = s.wordMode;
    return {
      maxPlayers: clamp(s.maxPlayers as number, 2, 20, DEFAULT_SETTINGS.maxPlayers),
      rounds: clamp(s.rounds as number, 2, 10, DEFAULT_SETTINGS.rounds),
      drawTime: clamp(s.drawTime as number, 15, 240, DEFAULT_SETTINGS.drawTime),
      wordCount: clamp(s.wordCount as number, 1, 5, DEFAULT_SETTINGS.wordCount),
      hints: clamp(s.hints as number, 0, 5, DEFAULT_SETTINGS.hints),
      wordMode:
        mode === 'hidden' || mode === 'combination' || mode === 'normal' ? mode : 'normal',
    };
  }

  private generateCode(): string {
    let code: string;
    do {
      code = Array.from(
        { length: 4 },
        () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
      ).join('');
    } while (this.rooms.has(code));
    return code;
  }

  createRoom(settings: Partial<RoomSettings> | undefined, isPrivate: boolean): Room {
    const code = this.generateCode();
    const room = new Room(code, this.io, GameServer.sanitizeSettings(settings), this.wordBank, isPrivate);
    this.rooms.set(code, room);
    return room;
  }

  getRoom(id: string): Room | undefined {
    return this.rooms.get(id.toUpperCase());
  }

  bindPlayer(token: string, roomId: string): void {
    this.playerToRoom.set(token, roomId);
  }

  roomForToken(token: string): Room | undefined {
    const roomId = this.playerToRoom.get(token);
    return roomId ? this.rooms.get(roomId) : undefined;
  }

  // -------------------------------------------------------------------------
  // Disconnect / reconnect
  // -------------------------------------------------------------------------

  /**
   * Marks a player as temporarily disconnected and schedules removal after the
   * grace window. If they reconnect first (`tryResume`), the timer is cancelled.
   */
  handleDisconnect(token: string): void {
    const room = this.roomForToken(token);
    if (!room) return;
    const player = room.players.get(token);
    if (!player) return;

    player.connected = false;
    player.disconnectedAt = Date.now();
    room.broadcastState(); // others see them greyed out

    const existing = this.graceTimers.get(token);
    if (existing) clearTimeout(existing);
    this.graceTimers.set(
      token,
      setTimeout(() => this.finalizeLeave(token), GRACE_MS)
    );
  }

  /** Re-attach a reconnecting socket to its existing player, if still within grace. */
  tryResume(socket: AppSocket): boolean {
    const token = socket.data.token;
    const room = this.roomForToken(token);
    const player = room?.players.get(token);
    if (!room || !player) {
      socket.emit('resume_failed');
      return false;
    }

    const timer = this.graceTimers.get(token);
    if (timer) {
      clearTimeout(timer);
      this.graceTimers.delete(token);
    }

    player.socketId = socket.id;
    player.connected = true;
    player.disconnectedAt = null;
    socket.join(room.id);

    socket.emit('resumed', {
      you: player.toView(),
      roomId: room.id,
      state: room.game.toStateView(room.playersView()),
    });
    room.broadcastState();
    return true;
  }

  /** Explicit leave (user pressed Leave) — remove immediately, skip grace. */
  leaveRoom(token: string): void {
    const timer = this.graceTimers.get(token);
    if (timer) {
      clearTimeout(timer);
      this.graceTimers.delete(token);
    }
    this.finalizeLeave(token);
  }

  private finalizeLeave(token: string): void {
    this.graceTimers.delete(token);
    const room = this.roomForToken(token);
    this.playerToRoom.delete(token);
    if (!room) return;
    room.removePlayer(token);
    if (room.isEmpty) {
      room.game.clearTimers();
      this.rooms.delete(room.id);
    }
  }
}
