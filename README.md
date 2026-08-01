# Skribbl Clone

A real-time multiplayer drawing-and-guessing game — an end-to-end clone of
[skribbl.io](https://skribbl.io). Players join a room, take turns drawing a secret
word on a shared canvas, and race to guess it in chat. Faster guesses score more,
turns rotate so everyone draws, and the highest score at the end wins. Every stroke,
guess, and score is synchronized in real time over WebSockets.

### ▶ Live demo: **https://skribbl-clone-z4ot.onrender.com**

> Hosted on Render's free tier, which sleeps after inactivity — the **first** load
> may take ~30–50s to wake the server, then it's instant. Open the link in two
> browser windows (or share the invite link) to play a full game.

---

## Features

**Gameplay**
- Public/private rooms with a 4-character join code and shareable invite link
- Lobby with player list, host controls, and host-configurable settings
- Turn-based rounds: one drawer picks 1 of N words; everyone else guesses
- Guessing with **skribbl-style scoring** (guess order + speed), a live leaderboard
  that crowns the current leader, and a winner at game end
- Progressive letter hints revealed over time

**Drawing**
- Real-time canvas sync using **normalized coordinates** — the drawing looks
  identical on every screen size
- Tools: brush, 16 colors, 4 brush sizes, eraser, undo, clear canvas
- Mid-game **canvas replay** so late joiners and reconnecting players see the
  drawing so far

**Social & moderation**
- Chat with anti-spoiler rules (correct guesses and drawer chat never leak the word
  to players still guessing)
- 👍 / 👎 **reactions** on the current drawing
- **Vote-kick** with a strict majority; kicked players are banned from the room
  (the host is immune)
- Host leaving closes the room and returns everyone to the home screen

**Reliability & polish**
- Server-authoritative game state, timer, and scoring (cheat-resistant)
- **Reconnection** — a stable session token plus a grace window lets a backgrounded
  phone or a page reload rejoin the same room with score and turn intact
- Procedural background music + sound effects (Web Audio, mutable)
- Responsive layout for phones, tablets, and desktop

**Configurable per room:** rounds (2–10), draw time (15–240s), max players (2–20),
word choices (1–5), hints (0–5).

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React + TypeScript + Vite, HTML5 Canvas (custom drawing logic) |
| Icons / audio | lucide-react · Web Audio API (synthesised, no assets) |
| Backend | Node.js + Express |
| Realtime | Socket.IO |
| State | In-memory (rooms are ephemeral; no database needed) |
| Words | Categorized JSON word list |
| Tests | Vitest (unit + integration) |

## Quick start

Requires Node.js 20+.

```bash
npm run install:all      # install server + client deps

npm run dev:server       # terminal 1 → backend on http://localhost:3001
npm run dev:client       # terminal 2 → frontend on http://localhost:5173
```

Open http://localhost:5173, then open a second window (or an incognito window) and
join with the room code / invite link to play. In dev, Vite proxies `/socket.io` to
the backend on port 3001. To play from a phone on the same network, start the client
with `npm --prefix client run dev -- --host` and open the printed Network URL.

## Testing

The backend logic and real-time layer are covered by an automated suite (Vitest):

```bash
npm test                              # run the full suite (26 tests)
npm --prefix server run test:watch    # watch mode
```

- **Unit tests** drive the `Game` state machine directly with fake timers — scoring
  (rank + time), drawer share, round rotation, game-over, early end, timeout, hints,
  word matching, reactions, and the drawer-leaves case. `Game` is pure logic with no
  socket dependency, which makes this fast and deterministic.
- **Integration tests** spin up a real Socket.IO server + clients and exercise
  create/join/start/guess scoring, host-leaves-closes-room, vote-kick + ban,
  host immunity, and **reconnection** (a stale disconnect never marks a live player
  offline; a genuine drop shows "reconnecting" and then restores).

## Production build

The server serves the built client from the **same origin**, so there's no CORS or
cross-service WebSocket configuration.

```bash
npm run build     # client → client/dist, server → server/dist
npm start         # serves the app + WebSockets on http://localhost:3001
```

## Deployment

WebSockets need a persistent server, so deploy to **Render** or **Railway** — not
Vercel/Netlify, whose serverless functions can't hold a WebSocket open. This repo is
deployed on Render via the included `render.yaml` blueprint:

1. Push the repo to GitHub.
2. In Render: **New → Blueprint** and select the repo. The blueprint provisions one
   web service that builds the client and serves it alongside the Socket.IO server.
3. Deploy. Render sets `PORT` automatically; the server reads it.

Equivalent manual settings:
- **Build:** `npm --prefix client install --include=dev && npm --prefix client run build && npm --prefix server install --include=dev && npm --prefix server run build`
- **Start:** `npm --prefix server start`

## Architecture

The server is the **single source of truth** — it owns turn order, the timer,
scores, the secret word, and stroke history. The client renders what it's told and
sends intents. This prevents word leaks, canvas desync, and client-clock bugs.

Server-side OOP model:

- **`GameServer`** — room registry, settings validation, connect/disconnect and
  reconnection handling.
- **`Room`** — the only socket-aware model; owns players, the stroke buffer, and one
  `Game`. Wires `Game`'s domain callbacks to Socket.IO broadcasts.
- **`Game`** — the finite state machine (`lobby → choosing → drawing → roundEnd →
  gameOver`), scoring, timer, hints, reactions. Pure logic, no socket knowledge —
  which is what makes it unit-testable.
- **`Player`** / **`WordBank`** — participant data (stable session token vs. current
  socket) and word selection + mask/hint generation.
- **`MessageHandler`** — one per connection; routes socket events to the models and
  enforces authorization (host-only, drawer-only).

A single shared `types/events.ts` defines every Socket.IO event and payload; it's kept
identical in the client and server so the wire protocol is type-checked on both sides.

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the full design: the event contract,
the state machine, the scoring formula, drawing sync, and the reconnection model.

## Project structure

```
skribbl-clone/
├── server/                 # Node + Express + Socket.IO
│   ├── src/
│   │   ├── index.ts            # bootstrap; serves the built client in prod
│   │   ├── GameServer.ts       # registry, settings, connect/disconnect/resume
│   │   ├── MessageHandler.ts   # socket event router + auth guards
│   │   ├── models/             # Room, Game, Player, WordBank
│   │   ├── types/              # events.ts (shared contract) + socket.ts
│   │   └── data/words.json
│   └── tests/                  # Vitest unit + integration suites
├── client/                 # React + Vite frontend
│   └── src/
│       ├── socket.ts, audio.ts, hooks/useGame.ts
│       ├── components/         # Home, Lobby, GameScreen, CanvasBoard, Toolbar, …
│       └── types/events.ts     # exact copy of the server contract
├── ARCHITECTURE.md         # full design document
└── render.yaml             # Render deployment blueprint
```
