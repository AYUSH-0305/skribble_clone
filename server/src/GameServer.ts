import type { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  RoomSettings,
  ServerToClientEvents,
} from './types/events.js';
import { DEFAULT_SETTINGS } from './types/events.js';
import { Room } from './models/Room.js';
import { WordBank } from './models/WordBank.js';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars

function clamp(v: number, lo: number, hi: number, fallback: number): number {
  if (typeof v !== 'number' || Number.isNaN(v)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

/**
 * Top-level registry. Owns every Room and maps socket ids back to their room so
 * disconnects can be cleaned up. All settings validation happens here — the
 * server never trusts client-supplied numbers.
 */
export class GameServer {
  private readonly rooms = new Map<string, Room>();
  private readonly socketToRoom = new Map<string, string>();
  private readonly wordBank = new WordBank();

  constructor(private readonly io: IO) {}

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

  bindSocket(socketId: string, roomId: string): void {
    this.socketToRoom.set(socketId, roomId);
  }

  roomForSocket(socketId: string): Room | undefined {
    const roomId = this.socketToRoom.get(socketId);
    return roomId ? this.rooms.get(roomId) : undefined;
  }

  onDisconnect(socketId: string): void {
    const room = this.roomForSocket(socketId);
    this.socketToRoom.delete(socketId);
    if (!room) return;
    room.removePlayer(socketId);
    if (room.isEmpty) {
      room.game.clearTimers();
      this.rooms.delete(room.id);
    }
  }
}
