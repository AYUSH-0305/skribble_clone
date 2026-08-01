import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from './events.js';

/** Per-connection data. `token` is the stable session id (survives reconnects). */
export interface SocketData {
  token: string;
}

// Server-side inter-server events are unused here.
type InterServerEvents = Record<string, never>;

export type AppServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
