import type { Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from './types/events.js';
import type { GameServer } from './GameServer.js';
import { Player } from './models/Player.js';

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

const MAX_NAME_LEN = 20;
const MAX_CHAT_LEN = 120;

function cleanName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().slice(0, MAX_NAME_LEN) : '';
  return s.length > 0 ? s : `Player${Math.floor(Math.random() * 1000)}`;
}

/**
 * One instance per connection. Translates raw socket events into Room/Game
 * method calls and enforces authorization (host-only, drawer-only). Contains no
 * game logic itself — only routing and guards.
 */
export class MessageHandler {
  constructor(
    private readonly socket: AppSocket,
    private readonly server: GameServer
  ) {
    this.register();
  }

  private register(): void {
    const s = this.socket;

    s.on('create_room', ({ hostName, settings, isPrivate }, ack) => {
      const room = this.server.createRoom(settings, isPrivate ?? true);
      const player = new Player(s.id, cleanName(hostName));
      s.join(room.id);
      this.server.bindSocket(s.id, room.id);
      room.addPlayer(player);
      ack?.({ ok: true, roomId: room.id, you: player.toView() });
    });

    s.on('join_room', ({ roomId, playerName }, ack) => {
      const room = this.server.getRoom(roomId ?? '');
      if (!room) return ack?.({ ok: false, error: 'Room not found' });
      if (room.players.size >= room.settings.maxPlayers)
        return ack?.({ ok: false, error: 'Room is full' });

      const player = new Player(s.id, cleanName(playerName));
      s.join(room.id);
      this.server.bindSocket(s.id, room.id);
      room.addPlayer(player);

      // Replay the current canvas so a mid-game joiner sees the drawing so far.
      const strokes = room.currentStrokes();
      if (strokes.length > 0) room.emitTo(s.id, 'canvas_state', { strokes });

      ack?.({
        ok: true,
        you: player.toView(),
        state: room.game.toStateView(room.playersView()),
        strokes,
      });
    });

    s.on('start_game', () => {
      const room = this.server.roomForSocket(s.id);
      if (!room) return;
      if (room.hostId !== s.id) return this.deny('Only the host can start the game');
      if (room.players.size < 2) return this.deny('Need at least 2 players to start');
      room.game.startGame();
    });

    s.on('leave_room', () => {
      const room = this.server.roomForSocket(s.id);
      if (!room) return;
      s.leave(room.id); // stop receiving this room's broadcasts (socket stays alive)
      this.server.leaveRoom(s.id); // remove player, migrate host, GC if empty
    });

    // --- Drawing (drawer-only) ---
    s.on('draw_start', (d) => {
      const room = this.drawerRoom();
      if (!room) return;
      room.startStroke(d.color, d.size, d.tool, { x: d.x, y: d.y });
    });

    s.on('draw_move', (p) => {
      const room = this.drawerRoom();
      if (!room) return;
      room.appendPoint({ x: p.x, y: p.y });
    });

    s.on('draw_end', () => {
      const room = this.drawerRoom();
      room?.endStroke();
    });

    s.on('canvas_clear', () => {
      const room = this.drawerRoom();
      room?.clearCanvas();
    });

    s.on('draw_undo', () => {
      const room = this.drawerRoom();
      room?.undoStroke();
    });

    // --- Round ---
    s.on('word_chosen', ({ word }) => {
      const room = this.server.roomForSocket(s.id);
      if (!room) return;
      room.game.chooseWord(s.id, word);
    });

    // --- Chat & guessing ---
    s.on('guess', ({ text }) => {
      const room = this.server.roomForSocket(s.id);
      if (!room) return;
      const player = room.players.get(s.id);
      if (!player) return;
      const clean = typeof text === 'string' ? text.slice(0, MAX_CHAT_LEN) : '';
      if (!clean.trim()) return;

      const outcome = room.game.submitGuess(player, clean);
      if (outcome.correct) {
        // Never echo the guess text — it would spoil the word.
        room.broadcast('guess_result', {
          playerId: player.id,
          playerName: player.name,
          correct: true,
          points: outcome.points,
          order: outcome.order,
        });
        room.broadcast('system_message', {
          text: `${player.name} guessed the word!`,
          kind: 'correct',
        });
      } else if (outcome.close) {
        // Private nudge only to the guesser.
        room.emitTo(s.id, 'system_message', { text: `"${clean}" is close!`, kind: 'info' });
      } else {
        // Wrong guess shows as a normal chat message to players still guessing.
        this.broadcastGuessAsChat(room, player, clean);
      }
    });

    s.on('chat', ({ text }) => {
      const room = this.server.roomForSocket(s.id);
      if (!room) return;
      const player = room.players.get(s.id);
      if (!player) return;
      const clean = typeof text === 'string' ? text.slice(0, MAX_CHAT_LEN) : '';
      if (!clean.trim()) return;
      this.broadcastGuessAsChat(room, player, clean);
    });
  }

  /**
   * Show a message as chat. If a guess round is active, hide it from players who
   * are still guessing when it comes from the drawer or an already-correct
   * player (so it can't leak the answer); those messages go only to "insiders".
   */
  private broadcastGuessAsChat(
    room: NonNullable<ReturnType<GameServer['roomForSocket']>>,
    player: Player,
    text: string
  ): void {
    const isDrawing = room.game.phase === 'drawing';
    const isInsider = player.hasGuessedThisRound || room.isDrawer(player.id);

    if (isDrawing && isInsider) {
      // Deliver only to the drawer and players who've already guessed correctly.
      for (const p of room.players.values()) {
        if (p.hasGuessedThisRound || room.isDrawer(p.id)) {
          room.emitTo(p.id, 'chat_message', {
            playerId: player.id,
            playerName: player.name,
            text,
          });
        }
      }
    } else {
      room.broadcast('chat_message', { playerId: player.id, playerName: player.name, text });
    }
  }

  /** The room this socket is in, but only if it is the current drawer. */
  private drawerRoom() {
    const room = this.server.roomForSocket(this.socket.id);
    if (!room) return undefined;
    return room.isDrawer(this.socket.id) ? room : undefined;
  }

  private deny(message: string): void {
    this.socket.emit('error_message', { message });
  }
}
