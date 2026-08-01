import { createServer } from 'http';
import { fileURLToPath } from 'url';
import path from 'path';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from './types/events.js';
import { GameServer } from './GameServer.js';
import { MessageHandler } from './MessageHandler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN; // set when frontend is on a different origin

const app = express();
const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: CLIENT_ORIGIN ? { origin: CLIENT_ORIGIN, methods: ['GET', 'POST'] } : { origin: '*' },
});

const gameServer = new GameServer(io);

io.on('connection', (socket) => {
  new MessageHandler(socket, gameServer);
  socket.on('disconnect', () => gameServer.onDisconnect(socket.id));
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
