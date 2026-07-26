# 🍡 Nexus Park

A persistent, multiplayer 3D world for the browser — a small metaverse where
every player is a bouncy **dango** dumpling. Explore a plaza with a café,
cinema, arcade, shop and park; watch synchronized videos and websites on
in-world screens; play arcade games against other players; talk over
proximity voice chat; and decorate a personal room that's saved forever.

Everything is real, modeled 3D geometry rendered with Three.js — no flat
image stand-ins — and every feature listed below is implemented and wired to
the authoritative server.

![Architecture](docs/architecture.md)

---

## Feature overview

| Area | What works |
| --- | --- |
| **Multiplayer** | Live positions/animations/emotes at 10 Hz snapshots with client interpolation, join/leave/reconnect handling, duplicate-login supersede, per-space interest management |
| **Avatars** | Customizable dango characters (body, scarf, blush, feet, sprout, hats, glasses) with squash-and-stretch hop animation, sit/wave/dance/clap/point/laugh, nametags, speaking indicators |
| **World** | Outdoor plaza (fountain, pond + bridge, park, buildings) + café, cinema, arcade, shop, tower lobby interiors; day/night cycle (20 min), weather (clear/cloudy/rain), NPCs with routines & dialogue |
| **Personal rooms** | Every account gets a persistent room: place/move/recolor/delete 26 furniture types, wall/floor/ceiling colors, lighting presets (warm/cool/party), public/private access, owner-or-guests media policy — all server-persisted |
| **Media screens** | Cinema screen + room TVs show **websites (iframe)**, **YouTube** (official embed, position-synced), or **direct video files** (synced). Local seek bar; server only relays tiny state — media streams to each client directly |
| **Interactions** | Seats everywhere, sliding doors, light switches, shared whiteboards, message boards, synth jukebox (beat-synced for all listeners), vending machines + inventory, furniture-unlock economy, beach ball with physics, books, computer notes, wardrobe storage, mirrors |
| **Games** | Two-player tic-tac-toe and solo Lights Out arcade cabinets with live spectator screens and a persistent high-score |
| **Voice chat** | Proximity WebRTC mesh with HRTF spatial audio, speaking indicators, push-button mute |
| **Audio** | Fully procedural: hop boings, UI chimes, wind/rain/birds/crickets ambience, three sequenced jukebox tracks — zero recorded assets |

## Quick start

Requirements: **Node.js ≥ 20** (that's it — the database is embedded SQLite).

```bash
npm install          # installs all three workspaces locally
npm run dev          # server on :8080 + Vite client on :5173
```

Open **http://localhost:5173**, create an account (or *Continue as guest*),
and you'll spawn in the plaza. Open a second browser window to see
multiplayer in action.

### Production build

```bash
npm run build        # builds client (vite) then server (esbuild)
npm start            # serves everything on http://127.0.0.1:8080
```

The production server serves the built client itself — one process, one port.

### Database

SQLite lives at `server/data/nexuspark.db` (created automatically).

```bash
npm run db:setup     # create tables explicitly (optional; happens on boot)
npm run db:reset     # wipe all data and start fresh
```

Deleting the repository folder removes every trace of the app — no global
installs, no system changes.

### Configuration

Copy `.env.example` to `.env` (repo root) and adjust. Defaults work out of
the box; set a strong `JWT_SECRET` for anything public. To test from other
devices on your LAN set `HOST=0.0.0.0`.

### Tests

```bash
npm test             # shared protocol tests + server suite (vitest)
```

The server suite includes a real end-to-end test that boots the HTTP+WS
stack, registers two accounts, and verifies movement snapshots and chat
delivery over live WebSockets.

## Controls

| Input | Action |
| --- | --- |
| `W A S D` / arrows | Hop around |
| `Shift` | Run (bigger bounces) |
| `Space` | Jump |
| Mouse drag | Orbit third-person camera · wheel zooms |
| `E` | Interact (whatever the prompt shows) |
| `Enter` | Chat |
| `1–5` | Emotes: wave, dance, clap, point, laugh |
| `Esc` | Close panel / cancel editor action |
| Room editor | `R` rotate ghost · `X`/`Del` delete selection |

## Architecture

```
shared/   TypeScript protocol (zod-validated), world layouts, catalogs,
          collision math — imported verbatim by BOTH client and server so
          interactable positions and colliders can never drift apart.
server/   Node + Express + ws + better-sqlite3. Authoritative state:
          movement validation (speed caps, bounds, colliders), seats, media,
          rooms, games, economy, NPCs, ball physics, day/night clock.
          10 Hz snapshot broadcast per occupied space.
client/   Vite + React + React Three Fiber. Client-predicted local player,
          interpolated remotes (130 ms buffer), procedural geometry/audio,
          DOM overlay UI, WebRTC voice.
```

Key decisions, message flow, and persistence details: **[docs/architecture.md](docs/architecture.md)**.

### Security & abuse prevention

- bcrypt password hashes, JWT sessions (secret auto-generated into
  `server/data/jwt-secret` if unset), guest accounts are real rows.
- Every WebSocket message is zod-validated; per-session token buckets on
  chat/media/boards/strokes/interactions; 64 KB frame cap; origin checks.
- Server-side movement validation (anti-teleport), seat occupancy, room
  ownership, media/whiteboard/board permission checks, URL classification
  (https/http only; YouTube IDs extracted; everything else embeds as a
  sandboxed iframe — no DRM or frame-busting circumvention).
- HTTP rate limits on login/register/guest per IP.

## Graphics settings

Settings ⚙️ → quality presets (low → ultra) plus individual toggles for
shadows, post-processing (SMAA + bloom + vignette), reflections/mirrors,
weather particles and clouds. Renderer DPR scales with the preset. Interiors
are separate spaces, so only the space you're in is ever rendered.

## Known limitations (honest list)

- **Media embedding**: sites that send `X-Frame-Options`/CSP `frame-ancestors`
  refuse to render in iframes (that's their policy; we don't bypass it).
  YouTube requires internet access at runtime. Direct video files must be
  reachable from each viewer's browser.
- **Voice** is a P2P mesh — great up to ~6-8 simultaneous speakers; there is
  no TURN server bundled, so very restrictive NATs may fail to connect
  (configure `STUN_SERVERS`, or add your own TURN in `voice.ts`).
- **Camera** can clip through walls in tight corners (no camera collision).
- One shared media state per space: multiple TVs in one room mirror the same
  content by design.
- No mobile touch controls yet; desktop browsers only.
- Whiteboard history caps at 500 strokes per board (oldest fade out).
- Server is a single Node process; fine for dozens of concurrent players,
  not built for thousands.

## Repository layout

```
shared/src/   constants, types, zod protocol, world layouts, catalogs, math
server/src/   config, db/, auth/, http/, ws/, game/ (world, space, handlers,
              rooms, dialogues, sessions), util/
server/test/  vitest: auth, world/permissions/games/economy, live e2e
client/src/   net/, state/, audio/, voice/, ui/ (panels, HUD, editor),
              world3d/ (avatar, animator, spaces, prefabs, env, media)
docs/         architecture notes
ASSETS.md     licensing of all bundled content
```

## License note for bundled content

All 3D geometry, textures, audio and music are **generated procedurally in
code** — there are no third-party binary assets. In-world books contain
public-domain texts (attributed) and original writing. See
[ASSETS.md](ASSETS.md).
