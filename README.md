# Skribbl Clone

A real-time multiplayer drawing-and-guessing game (a [skribbl.io](https://skribbl.io)
clone). Players join a room, take turns drawing a secret word on a shared canvas, and
race to guess it in chat. Correct guesses score points (faster = more), turns rotate,
and the highest score at the end wins. Everything is synchronized over WebSockets.

**Live demo:** _<!-- TODO: paste your Render/Railway URL here after deploying, e.g. https://skribbl-clone.onrender.com -->_

---

## Features

**Core**
- Public/private rooms with a 4-character join code and invite link
- Lobby with player list, host controls, host-configurable settings
- Turn-based rounds: one drawer, everyone else guesses
- Real-time drawing sync (normalized coordinates → identical on every screen size)
- Word selection: drawer picks 1 of N words; guessers see a blank mask
- Guessing with time-decay scoring, live leaderboard, winner at game end
- Drawing tools: brush, 16 colors, 4 sizes, eraser, undo, clear canvas
- Progressive letter hints revealed over time
- Chat + guessing with anti-spoiler rules (correct guesses and drawer chat never
  leak the word to players still guessing)
- Server-authoritative round timer and mid-game canvas replay for late joiners

**Configurable per room:** rounds (2–10), draw time (15–240s), max players (2–20),
word choices (1–5), hints (0–5).

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React + TypeScript + Vite, HTML5 Canvas (custom drawing logic) |
| Backend | Node.js + Express |
| Realtime | Socket.IO |
| State | In-memory (rooms are ephemeral; no DB needed for MVP) |
| Words | JSON word list, categorized |

## Project structure

```
skribbl-clone/
├── server/            # Node + Express + Socket.IO (game logic lives here)
│   └── src/
│       ├── index.ts           # bootstrap; serves the built client in prod
│       ├── GameServer.ts      # room registry + settings validation
│       ├── MessageHandler.ts  # socket event router + authorization guards
│       ├── models/
│       │   ├── Room.ts        # players + Game + stroke buffer; only socket-aware model
│       │   ├── Game.ts        # the FSM: rounds, turns, timer, scoring (socket-free)
│       │   ├── Player.ts
│       │   └── WordBank.ts    # word picking + mask/hint generation
│       └── types/events.ts    # SHARED wire contract (duplicated in client)
├── client/            # React + Vite frontend
│   └── src/
│       ├── socket.ts, hooks/useGame.ts
│       ├── components/CanvasBoard, Toolbar, Lobby, GameScreen, ChatPanel, …
│       └── types/events.ts    # exact copy of the server contract
├── ARCHITECTURE.md    # full design doc (class model, event contract, FSM)
└── render.yaml        # one-click Render deployment blueprint
```

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the complete design: the OOP class
model, the locked WebSocket event contract, the game state machine, the scoring
formula, and the drawing-sync approach.

## Running locally

Requires Node.js 20+.

```bash
# 1. Install both packages
npm run install:all          # or: npm --prefix server install && npm --prefix client install

# 2. Start the backend (terminal 1) — http://localhost:3001
npm run dev:server

# 3. Start the frontend (terminal 2) — http://localhost:5173
npm run dev:client
```

Open http://localhost:5173. To try a full game on one machine, open a second browser
tab/window, create a room in one and join it (via code or invite link) in the other.
In dev, Vite proxies `/socket.io` to the backend on port 3001.

## Testing

The backend has an automated test suite (Vitest) covering the game logic and the
real-time layer:

```bash
npm test                       # from the repo root (runs the server suite)
npm --prefix server run test:watch   # watch mode while developing
```

- **Unit tests** (`server/tests/game.test.ts`, `helpers.test.ts`) drive the `Game`
  state machine directly with fake timers — scoring (rank + time), the drawer
  share, round rotation, game-over, early end when everyone guesses, timeout,
  hint reveals, word matching, and the drawer-leaves case. `Game` is pure logic
  with no socket dependency, which is what makes this possible.
- **Integration tests** (`server/tests/integration.test.ts`) spin up a real
  Socket.IO server + clients and exercise create/join/start/guess, host
  migration, and — importantly — **reconnection**: it verifies a stale
  disconnect during a reconnect never marks a live player offline, and that a
  genuinely dropped player is shown as reconnecting and then restored.

## Production build

The server serves the built client from the **same origin**, so there is no CORS or
cross-service WebSocket configuration.

```bash
npm run build     # builds client -> client/dist, compiles server -> server/dist
npm start         # serves app + WebSockets on http://localhost:3001
```

## Deployment (Render)

WebSockets need a persistent server, so deploy the backend to **Render** or **Railway**
— not Vercel/Netlify (their serverless functions can't hold a WebSocket open).

Using the included blueprint:
1. Push this repo to GitHub.
2. In Render: **New → Blueprint**, select the repo. `render.yaml` provisions a single
   web service that builds the client and serves it alongside the Socket.IO server.
3. Deploy, then put the resulting URL in the **Live demo** line at the top of this file.

Manual setup (equivalent):
- **Build command:** `npm --prefix client install && npm --prefix client run build && npm --prefix server install && npm --prefix server run build`
- **Start command:** `npm --prefix server start`
- Render sets `PORT` automatically; the server reads it.

## How it works (walkthrough notes)

- **Drawing sync** — the drawer's pointer input is captured as strokes of
  normalized `(x, y)` points (0–1), streamed as `draw_start`/`draw_move`/`draw_end`
  (moves coalesced to one per animation frame). The server buffers stroke history per
  room and rebroadcasts, so all clients — including the drawer, for consistency — render
  from the same source, and late joiners get a full `canvas_state` replay.
- **Game state** — a per-room finite state machine
  (`lobby → choosing → drawing → roundEnd → gameOver`) lives in `Game.ts`, which is
  pure logic with no socket knowledge. The round **timer is server-owned**; clients only
  render a countdown from the authoritative `roundEndsAt`.
- **No word leaks** — the plaintext word is sent only to the drawer via a targeted
  `word_reveal`; every other client receives a masked form (`_ _ a`). Correct guesses
  are never echoed as chat text.
- **Word matching** — guesses are normalized (trim + lowercase + collapse whitespace);
  an edit-distance-1 near miss is privately flagged as "close".
- **Scoring** (skribbl.io-style) — a guesser's points combine **rank** (the 1st
  correct guesser scores more than the 2nd, etc.) and **time remaining**, so
  `points = base(rank) + timeBonus`. The drawer earns a share of the guessers'
  points scaled by how many of the eligible players guessed
  (`round(Σ points / eligibleGuessers × 0.7)`) — always below the top guesser,
  and zero if nobody guesses. Example: 1st ≈ 399, 2nd ≈ 359, 3rd ≈ 319 →
  drawer 251.
