import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from './types/events';

// One socket for the whole app. In dev, Vite proxies /socket.io -> :3001.
// In prod the client is served from the same origin as the server, so the
// default (same-origin) connection just works.
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  autoConnect: true,
});
