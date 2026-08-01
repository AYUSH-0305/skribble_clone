import type { DrawTool, Point, RoomSettings, ServerToClientEvents, Stroke } from '../types/events.js';
import type { AppServer } from '../types/socket.js';
import { Game, type GameCallbacks } from './Game.js';
import { Player } from './Player.js';
import { WordBank } from './WordBank.js';

type IO = AppServer;

let strokeSeq = 0;

/**
 * A single game room. Owns its players, one Game (the FSM), and the canvas
 * stroke history. This is the ONLY model that touches Socket.IO — it wires
 * Game's domain callbacks to broadcasts.
 */
export class Room {
  readonly id: string;
  readonly isPrivate: boolean;
  readonly settings: RoomSettings;
  readonly players = new Map<string, Player>();
  hostId: string | null = null;

  strokes: Stroke[] = [];
  private activeStroke: Stroke | null = null;

  // Votekick: target token -> set of voter tokens. Banned tokens can't rejoin.
  private readonly votes = new Map<string, Set<string>>();
  private readonly banned = new Set<string>();

  readonly game: Game;

  constructor(id: string, io: IO, settings: RoomSettings, wordBank: WordBank, isPrivate: boolean) {
    this.id = id;
    this.io = io;
    this.settings = settings;
    this.isPrivate = isPrivate;

    const callbacks: GameCallbacks = {
      onStateChange: () => this.broadcastState(),
      onRoundStart: (d) => this.broadcast('round_start', d),
      onWordOptions: (drawerId, options) => this.emitTo(drawerId, 'word_options', { options }),
      onWordReveal: (drawerId, word) => this.emitTo(drawerId, 'word_reveal', { word }),
      onDrawingStarted: (d) => this.broadcast('drawing_started', d),
      onHintUpdate: (d) => this.broadcast('hint_update', d),
      onRoundEnd: (d) => this.broadcast('round_end', d),
      onGameOver: ({ winnerId }) => {
        const leaderboard = this.playersView().sort((a, b) => b.score - a.score);
        const winner = leaderboard.find((p) => p.id === winnerId) ?? null;
        this.broadcast('game_over', { winner, leaderboard });
      },
      onClearCanvas: () => {
        this.strokes = [];
        this.activeStroke = null;
        this.broadcast('canvas_clear');
      },
      onReactions: (data) => this.broadcast('reactions', data),
    };

    this.game = new Game(this.players, this.settings, wordBank, callbacks);
  }

  private readonly io: IO;

  // -------------------------------------------------------------------------
  // Membership
  // -------------------------------------------------------------------------

  addPlayer(player: Player): void {
    if (this.players.size === 0) {
      player.isHost = true;
      this.hostId = player.id;
    }
    this.players.set(player.id, player);
    this.broadcast('player_joined', { player: player.toView(), players: this.playersView() });
    this.broadcastState();
  }

  removePlayer(id: string): void {
    const player = this.players.get(id);
    if (!player) return;
    this.players.delete(id);

    // Drop any votekick state involving this player.
    this.votes.delete(id);
    for (const set of this.votes.values()) set.delete(id);

    // Host migration.
    let newHostId: string | undefined;
    if (this.hostId === id) {
      const next = [...this.players.values()][0];
      if (next) {
        next.isHost = true;
        this.hostId = next.id;
        newHostId = next.id;
      } else {
        this.hostId = null;
      }
    }

    this.game.handlePlayerLeft(id);
    this.broadcast('player_left', { playerId: id, players: this.playersView(), newHostId });
    this.broadcastState();
  }

  get isEmpty(): boolean {
    return this.players.size === 0;
  }

  isDrawer(id: string): boolean {
    return this.game.drawerId === id;
  }

  // -------------------------------------------------------------------------
  // Votekick / ban
  // -------------------------------------------------------------------------

  /**
   * Register `voter`'s vote to kick `target`. Returns the current tally and
   * whether the strict majority needed to kick has been reached. Only votes
   * from players still present and connected are counted.
   */
  addVote(voter: string, target: string): { votes: number; needed: number; kicked: boolean } {
    let set = this.votes.get(target);
    if (!set) {
      set = new Set();
      this.votes.set(target, set);
    }
    set.add(voter);

    const validVoters = [...set].filter((v) => this.players.get(v)?.connected);
    const votes = validVoters.length;

    // Eligible voters: everyone connected except the target themselves.
    const eligible = [...this.players.values()].filter((p) => p.connected && p.id !== target).length;
    const needed = Math.floor(eligible / 2) + 1; // strict majority
    return { votes, needed, kicked: votes >= needed };
  }

  clearVotesFor(target: string): void {
    this.votes.delete(target);
  }

  ban(id: string): void {
    this.banned.add(id);
  }

  isBanned(id: string): boolean {
    return this.banned.has(id);
  }

  // -------------------------------------------------------------------------
  // Canvas / strokes
  // -------------------------------------------------------------------------

  startStroke(color: string, size: number, tool: DrawTool, first: Point): void {
    const stroke: Stroke = {
      id: `s${strokeSeq++}`,
      color,
      size,
      tool,
      points: [first],
    };
    this.activeStroke = stroke;
    // Broadcast the stroke start so clients register its id + style immediately.
    this.broadcast('draw_data', { stroke });
  }

  appendPoint(point: Point): void {
    if (!this.activeStroke) return;
    this.activeStroke.points.push(point);
    this.broadcast('draw_point', { strokeId: this.activeStroke.id, point });
  }

  endStroke(): void {
    if (!this.activeStroke) return;
    this.strokes.push(this.activeStroke);
    this.activeStroke = null;
  }

  undoStroke(): void {
    this.activeStroke = null;
    this.strokes.pop();
    // Re-send authoritative canvas to everyone.
    this.broadcast('canvas_clear');
    for (const stroke of this.strokes) this.broadcast('draw_data', { stroke });
  }

  clearCanvas(): void {
    this.strokes = [];
    this.activeStroke = null;
    this.broadcast('canvas_clear');
  }

  /** Full canvas replay for a joining/reconnecting client. */
  currentStrokes(): Stroke[] {
    return this.activeStroke ? [...this.strokes, this.activeStroke] : this.strokes;
  }

  // -------------------------------------------------------------------------
  // Broadcasting
  // -------------------------------------------------------------------------

  broadcast<E extends keyof ServerToClientEvents>(
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void {
    this.io.to(this.id).emit(event, ...args);
  }

  /** Emit to a single player by their (stable) token, routed to their live socket. */
  emitTo<E extends keyof ServerToClientEvents>(
    playerId: string,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void {
    const player = this.players.get(playerId);
    if (player && player.connected) this.io.to(player.socketId).emit(event, ...args);
  }

  playersView() {
    return [...this.players.values()].map((p) => p.toView());
  }

  broadcastState(): void {
    this.broadcast('game_state', this.game.toStateView(this.playersView()));
  }
}
