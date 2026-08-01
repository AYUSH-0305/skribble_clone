import { afterEach, describe, it, expect } from 'vitest';
import { createServer, type Server as HttpServer } from 'http';
import { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../src/types/events.js';
import type { SocketData } from '../src/types/socket.js';
import { GameServer } from '../src/GameServer.js';
import { MessageHandler } from '../src/MessageHandler.js';

// ---------------------------------------------------------------------------
// Test server: the exact wiring from index.ts, minus Express/static serving.
// ---------------------------------------------------------------------------
interface TestServer {
  url: string;
  close: () => Promise<void>;
}

function startServer(): Promise<TestServer> {
  const httpServer: HttpServer = createServer();
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(
    httpServer,
    { cors: { origin: '*' } }
  );
  const gs = new GameServer(io);

  io.on('connection', (socket) => {
    const token = socket.handshake.auth?.token;
    socket.data.token = typeof token === 'string' && token.length > 0 ? token : `anon-${socket.id}`;
    new MessageHandler(socket, gs);
    gs.tryResume(socket);
    socket.on('disconnect', () => gs.handleDisconnect(socket.data.token, socket.id));
  });

  return new Promise((resolve) => {
    httpServer.listen(() => {
      const { port } = httpServer.address() as AddressInfo;
      resolve({
        url: `http://localhost:${port}`,
        close: () =>
          new Promise<void>((res) => {
            io.close();
            httpServer.close(() => res());
          }),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Client helpers
// ---------------------------------------------------------------------------
type C = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const once = <T = unknown>(sock: C, event: string) =>
  new Promise<T>((res) => sock.once(event as never, res as never));
const emitAck = <T = unknown>(sock: C, event: string, data: unknown) =>
  new Promise<T>((res) => (sock as never as { emit: Function }).emit(event, data, res));

describe('integration: rooms, gameplay, reconnection', () => {
  let server: TestServer;
  const clients: C[] = [];

  const mkClient = (url: string, token: string): C => {
    const c = Client(url, { transports: ['websocket'], auth: { token }, forceNew: true }) as C;
    clients.push(c);
    return c;
  };

  afterEach(async () => {
    for (const c of clients) c.close();
    clients.length = 0;
    if (server) await server.close();
  });

  it('runs create → join → start → guess and scores correctly', async () => {
    server = await startServer();
    const host = mkClient(server.url, 'tok-host');
    await once(host, 'connect');
    const created = await emitAck<{ ok: boolean; roomId: string }>(host, 'create_room', {
      hostName: 'Host',
      settings: { drawTime: 80, hints: 0 },
    });
    expect(created.ok).toBe(true);

    const guesser = mkClient(server.url, 'tok-guess');
    await once(guesser, 'connect');
    const joined = await emitAck<{ ok: boolean }>(guesser, 'join_room', {
      roomId: created.roomId,
      playerName: 'Gwen',
    });
    expect(joined.ok).toBe(true);

    // Whichever socket becomes the drawer will receive the word; the other guesses.
    let word: string | null = null;
    let drawer: C | null = null;
    host.on('word_reveal', ({ word: w }) => {
      word = w;
      drawer = host;
    });
    guesser.on('word_reveal', ({ word: w }) => {
      word = w;
      drawer = guesser;
    });
    host.on('word_options', ({ options }) => host.emit('word_chosen' as never, { word: options[0] } as never));
    guesser.on('word_options', ({ options }) =>
      guesser.emit('word_chosen' as never, { word: options[0] } as never)
    );

    let scored = false;
    const scorer = new Promise<void>((res) => {
      const check = (d: { correct: boolean; points?: number }) => {
        if (d.correct && (d.points ?? 0) > 0) {
          scored = true;
          res();
        }
      };
      host.on('guess_result', check);
      guesser.on('guess_result', check);
    });

    host.emit('start_game' as never);
    await delay(400);
    expect(word).toBeTruthy();

    const other = drawer === host ? guesser : host;
    other.emit('guess' as never, { text: word! } as never);
    await Promise.race([scorer, delay(1500)]);
    expect(scored).toBe(true);
  });

  it('does NOT mark a player offline on a stale disconnect (reconnect race)', async () => {
    server = await startServer();
    const host = mkClient(server.url, 'tok-h');
    await once(host, 'connect');
    const created = await emitAck<{ ok: boolean; roomId: string }>(host, 'create_room', {
      hostName: 'Host',
      settings: {},
    });

    const p1 = mkClient(server.url, 'tok-pat');
    await once(p1, 'connect');
    await emitAck(p1, 'join_room', { roomId: created.roomId, playerName: 'Pat' });

    let latestPlayers: { id: string; connected: boolean }[] = [];
    host.on('game_state', (st) => (latestPlayers = st.players));
    let patLeftFired = false;
    host.on('player_left', (d) => {
      if (d.playerId === 'tok-pat') patLeftFired = true;
    });

    // RACE: Pat reconnects (new socket, same token) and resumes BEFORE the old
    // socket's disconnect is processed.
    const p2 = mkClient(server.url, 'tok-pat');
    await once(p2, 'resumed');
    p1.disconnect(); // stale disconnect from the superseded socket
    await delay(600);

    const pat = latestPlayers.find((pl) => pl.id === 'tok-pat');
    expect(pat).toBeTruthy();
    expect(pat!.connected).toBe(true); // must NOT show "reconnecting"
    expect(patLeftFired).toBe(false); // must NOT be removed
  });

  it('marks a genuinely dropped player offline, then restores on reconnect', async () => {
    server = await startServer();
    const host = mkClient(server.url, 'tok-h2');
    await once(host, 'connect');
    const created = await emitAck<{ ok: boolean; roomId: string }>(host, 'create_room', {
      hostName: 'Host',
      settings: {},
    });

    const q1 = mkClient(server.url, 'tok-quinn');
    await once(q1, 'connect');
    await emitAck(q1, 'join_room', { roomId: created.roomId, playerName: 'Quinn' });

    const states: { players: { id: string; connected: boolean }[] }[] = [];
    host.on('game_state', (st) => states.push(st));

    // Genuine drop, no replacement socket.
    q1.disconnect();
    await delay(400);
    let quinn = states[states.length - 1]?.players.find((p) => p.id === 'tok-quinn');
    expect(quinn?.connected).toBe(false); // grace period: shown as reconnecting

    // Reconnect with the same token -> resumed and back online.
    const q2 = mkClient(server.url, 'tok-quinn');
    await once(q2, 'resumed');
    await delay(200);
    quinn = states[states.length - 1]?.players.find((p) => p.id === 'tok-quinn');
    expect(quinn?.connected).toBe(true);
  });

  it('closes the room for everyone when the host leaves', async () => {
    server = await startServer();
    const host = mkClient(server.url, 'tok-h3');
    await once(host, 'connect');
    const created = await emitAck<{ ok: boolean; roomId: string }>(host, 'create_room', {
      hostName: 'Host',
      settings: {},
    });

    const p = mkClient(server.url, 'tok-next');
    await once(p, 'connect');
    await emitAck(p, 'join_room', { roomId: created.roomId, playerName: 'Next' });

    const closed = new Promise<boolean>((res) => p.on('room_closed', () => res(true)));
    host.emit('leave_room' as never);
    const got = await Promise.race([closed, delay(1000).then(() => false)]);
    expect(got).toBe(true);
  });

  it('keeps the room open when a NON-host leaves', async () => {
    server = await startServer();
    const host = mkClient(server.url, 'tok-h4');
    await once(host, 'connect');
    const created = await emitAck<{ ok: boolean; roomId: string }>(host, 'create_room', {
      hostName: 'Host',
      settings: {},
    });

    const guest = mkClient(server.url, 'tok-guest');
    await once(guest, 'connect');
    await emitAck(guest, 'join_room', { roomId: created.roomId, playerName: 'Guest' });

    let hostGotClosed = false;
    host.on('room_closed', () => (hostGotClosed = true));
    const left = new Promise<string>((res) => host.on('player_left', (d) => res(d.playerId)));

    guest.emit('leave_room' as never);
    const leftId = await Promise.race([left, delay(1000).then(() => 'timeout')]);
    expect(leftId).toBe('tok-guest');
    await delay(200);
    expect(hostGotClosed).toBe(false);
  });

  it('vote-kicks a player on majority and bans them from rejoining', async () => {
    server = await startServer();
    const host = mkClient(server.url, 'k-host');
    await once(host, 'connect');
    const created = await emitAck<{ ok: boolean; roomId: string }>(host, 'create_room', {
      hostName: 'Host',
      settings: {},
    });
    const p2 = mkClient(server.url, 'k-p2');
    await once(p2, 'connect');
    await emitAck(p2, 'join_room', { roomId: created.roomId, playerName: 'Two' });
    const p3 = mkClient(server.url, 'k-p3');
    await once(p3, 'connect');
    await emitAck(p3, 'join_room', { roomId: created.roomId, playerName: 'Three' });

    // 3 players -> to kick p3, eligible voters = host + p2 = 2, majority needed = 2.
    const kicked = new Promise<boolean>((res) => p3.on('kicked', () => res(true)));
    host.emit('votekick' as never, { targetId: 'k-p3' } as never);
    await delay(150); // one vote: not enough
    p2.emit('votekick' as never, { targetId: 'k-p3' } as never);

    const got = await Promise.race([kicked, delay(1000).then(() => false)]);
    expect(got).toBe(true);

    // Banned: rejoin is refused.
    const p3b = mkClient(server.url, 'k-p3');
    await once(p3b, 'connect');
    const rejoin = await emitAck<{ ok: boolean; error?: string }>(p3b, 'join_room', {
      roomId: created.roomId,
      playerName: 'Three',
    });
    expect(rejoin.ok).toBe(false);
  });

  it('never lets the host be vote-kicked', async () => {
    server = await startServer();
    const host = mkClient(server.url, 'im-host');
    await once(host, 'connect');
    const created = await emitAck<{ ok: boolean; roomId: string }>(host, 'create_room', {
      hostName: 'Host',
      settings: {},
    });
    const p2 = mkClient(server.url, 'im-p2');
    await once(p2, 'connect');
    await emitAck(p2, 'join_room', { roomId: created.roomId, playerName: 'Two' });

    const denied = new Promise<string>((res) => p2.on('error_message', (d) => res(d.message)));
    p2.emit('votekick' as never, { targetId: 'im-host' } as never);
    const msg = await Promise.race([denied, delay(600).then(() => '')]);
    expect(msg.toLowerCase()).toContain('host');
  });
});
