# Nexus Park — architecture notes

## The one important trick: shared world data

`shared/src/layouts.ts` defines every public space **once**: bounds, spawn
points, colliders, interactable objects (seats, doors, switches, screens,
machines, vending, boards) and NPC routes. Both sides import it:

- the **client** renders prefabs at those positions and runs the *same*
  `resolveCollisions()` for prediction;
- the **server** validates every interaction (distance checks), resolves the
  same collisions authoritatively, and drives NPCs along the same waypoints.

Positions therefore cannot drift between what you see and what the server
accepts. Personal rooms are the dynamic equivalent: `RoomData` rows from
SQLite are transformed into colliders/seat maps by mirrored code paths
(`server/src/game/space.ts` ⇄ `client/src/world3d/interact.ts`).

## Message flow

```
Browser                        Server
  │  POST /api/register|login|guest  → JWT
  │  WS /ws  hello{token}            → welcome{self, env, space snapshot}
  │  input{p, ry, st, seq}  15 Hz    → validate speed/bounds/colliders
  │                                   → 10 Hz snap{e:[id,x,y,z,ry,st]…}
  │  chat / sit / media_* / room_edit / game_* / rtc / …  (zod-validated)
  │                                   ← targeted broadcasts per space
```

- **State int** packs anim id, speaking flag and held-item id into one
  number per entity per snapshot.
- **Interest management**: players only receive data for their current
  space; each space serializes its snapshot once per tick and reuses the
  string for every recipient.
- **Client prediction**: the local dango moves immediately; the server can
  send `correction` if a position is rejected (anti-teleport). Remote
  entities render ~130 ms in the past and interpolate between snapshots.
- **Clock sync**: snapshot timestamps feed a smoothed server-time offset
  used by media sync, the jukebox beat grid, and the day/night cycle.

## Media synchronization (screens)

The server stores only `{url, kind, playing, position, rate, loop,
updatedAt, setBy}` — a few dozen bytes. Media bytes never touch the server:

- `site` → sandboxed iframe (everyone sees the same URL; interactive).
- `youtube` → official IFrame API; each client seeks so that
  `|current − (position + (now − updatedAt)·rate)| ≤ ~1.5 s`.
- `video` → HTML5 `<video>` with the same steering (±1.25 s window).

The control panel's seek bar reads duration/position from the *local*
player and broadcasts only a `seek` op. Cinema screens are controllable by
anyone (rate-limited); room TVs respect the owner's policy.

## Persistence (SQLite via better-sqlite3, WAL mode)

| Table | Contents |
| --- | --- |
| `users` | credentials, avatar JSON, credits, last space/position |
| `rooms`, `room_objects` | room meta/style/notes + every placed object |
| `inventory`, `unlocks` | items and one-time furniture unlocks |
| `board_posts` | message-board notes (capped per board) |
| `whiteboards` | stroke arrays (debounced writes) |
| `media_states` | per-space screen state (cinema + rooms survive restarts) |
| `world_kv` | world clock, weather, switch states, arcade records |

Room spaces are loaded on demand and evicted 5 minutes after emptying;
whiteboards flush on a 3 s dirty timer and on shutdown (SIGINT/SIGTERM are
trapped for a clean persist).

## Server modules

```
index.ts       boot: db → auth → world → express → ws gateway
config.ts      env parsing, JWT secret bootstrap, logging
db/            schema (idempotent), kv helpers, setup/reset CLI
auth/          register/login/guest, bcrypt+JWT, daily bonus
http/          REST auth endpoints, static client, compression, CORS (dev)
ws/gateway.ts  hello handshake, heartbeat, zod dispatch, dup-login kick
game/world.ts  space registry, membership, env clock/weather, tick loop
game/space.ts  per-space state: seats, chat, media, music, whiteboards,
               switches, ball physics, NPC runtime, arcade games
game/handlers.ts  every client message (validation + permissions)
game/roomService.ts  room CRUD + starter furnishing + directory
game/dialogues.ts    NPC dialogue trees (with buy actions)
util/rateLimiter.ts  token buckets (per-session + per-IP keyed)
```

## Client modules

```
net/connection.ts   WS client: reconnect w/ backoff, dispatch → stores
state/hot.ts        non-React entity state (interp buffers, camera, keys)
state/stores.ts     zustand stores: session, world, chat, ui, settings, voice
world3d/Scene.tsx   sky/env + space renderer + players + postfx
world3d/LocalPlayer.tsx  input, physics (shared collisions), camera rig,
                    interaction scanning, network send
world3d/Avatar.tsx + animator.ts  procedural dango rig & poses
world3d/spaces/     Plaza, generic Interior (per-space configs), PersonalRoom
                    (+ in-world placement editor), prop/interactable registry
world3d/prefabs/    all modeled objects (props, buildings, furniture,
                    interactive fixtures)
world3d/media/      screen overlays (site/youtube/video) + local runtime
audio/              procedural SFX/ambience engine + sequenced jukebox
voice/voice.ts      WebRTC mesh, HRTF panners, level analysis
ui/                 HUD, chat, all panels, room editor bar, auth screen
```

## Performance practices

- One draw-call-friendly material per prefab (`useMemo`), shared canvas
  textures with repeat wrapping, geometry reuse inside components.
- Hot entity data lives outside React; React re-renders only on roster/UI
  changes. Snapshot application and interpolation are O(entities).
- Per-space rendering (interiors never render the plaza), fog + far-plane
  culling outdoors, LOD-lite via settings (shadow size, DPR, particles,
  reflections, postfx).
- Server serializes each snapshot once per space per tick; whiteboard and
  position persistence are debounced.

## Deployment

`npm run build && npm start` produces a single Node process on `PORT`
serving HTTP, WS and the static client (gzip via compression). Put it
behind any TLS-terminating reverse proxy (the client auto-uses `wss:` on
https pages). Set `JWT_SECRET`, keep `server/data/` on a persistent volume.
