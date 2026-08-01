import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from './types/events';

/**
 * A stable per-browser session token. It identifies the player across
 * reconnects (phone backgrounding, brief network drops, even a page reload
 * within the server's grace window), so the server re-attaches us to our room
 * instead of treating the reconnect as a brand-new player.
 */
function getSessionToken(): string {
  const KEY = 'skribbl_token';
  try {
    let t = localStorage.getItem(KEY);
    if (!t) {
      t =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `t_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(KEY, t);
    }
    return t;
  } catch {
    // localStorage blocked (e.g. private mode) — fall back to a per-load token.
    return `t_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

// One socket for the whole app. In dev, Vite proxies /socket.io -> :3001.
// In prod the client is served from the same origin as the server, so the
// default (same-origin) connection just works. Socket.IO auto-reconnects.
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  autoConnect: true,
  auth: { token: getSessionToken() },
});
