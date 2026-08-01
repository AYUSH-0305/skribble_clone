import { createServer } from 'http';
import { fileURLToPath } from 'url';
import path from 'path';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from './types/events.js';
import type { SocketData } from './types/socket.js';
import { GameServer } from './GameServer.js';
import { MessageHandler } from './MessageHandler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN; // set when frontend is on a different origin

const app = express();
const httpServer = createServer(app);

const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>(httpServer, {
  cors: CLIENT_ORIGIN ? { origin: CLIENT_ORIGIN, methods: ['GET', 'POST'] } : { origin: '*' },
});

const gameServer = new GameServer(io);

io.on('connection', (socket) => {
  // Stable per-player identity from the client (falls back to the socket id).
  const token = socket.handshake.auth?.token;
  socket.data.token = typeof token === 'string' && token.length > 0 ? token : `anon-${socket.id}`;

  new MessageHandler(socket, gameServer);
  gameServer.tryResume(socket); // re-attach if this token was mid-game

  socket.on('disconnect', () => gameServer.handleDisconnect(socket.data.token, socket.id));
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// In production, serve the built client from the same origin (no CORS needed).
const clientDist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) res.status(404).send('Client build not found. Run `npm run build` in client/.');
  });
});

httpServer.listen(PORT, () => {
  console.log(`skribbl-clone server listening on http://localhost:${PORT}`);
});
