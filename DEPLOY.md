# Deploying the Nexus Park server

The whole app is **one Node.js process**: it serves the HTTP API, the
WebSocket endpoint and the built client from a single port, with an embedded
SQLite database. No external database, no other services.

## 1. Build & run (any Linux/macOS/Windows box with Node ≥ 20)

```bash
git clone <your-repo> nexus-park && cd nexus-park
npm install                 # everything installs inside this folder
npm run build               # client (vite) + server (esbuild → server/dist)

# configure
cp .env.example .env
#   PORT=8080
#   HOST=0.0.0.0            ← listen on all interfaces for public access
#   JWT_SECRET=<long random string>   ← REQUIRED for production
#   (generate: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")

npm start                   # → http://<server-ip>:8080
```

That's a complete deployment. Players open `http://<server-ip>:8080`.

## 2. What must persist

Only one directory: **`server/data/`** — it contains `nexuspark.db` (all
accounts, rooms, boards, media states) and the auto-generated `jwt-secret`.

- **Backup**: stop the server (or just copy — WAL mode tolerates it):
  `cp server/data/nexuspark.db* backups/`
- **Reset world**: `npm run db:reset` (destroys all data).
- In Docker/VMs, mount `server/data/` on a volume.

## 3. Run it as a service (systemd example)

```ini
# /etc/systemd/system/nexuspark.service
[Unit]
Description=Nexus Park metaverse server
After=network.target

[Service]
WorkingDirectory=/opt/nexus-park
ExecStart=/usr/bin/node server/dist/index.js
Restart=on-failure
Environment=PORT=8080
Environment=HOST=127.0.0.1
Environment=JWT_SECRET=change-me-to-something-long
# graceful shutdown persists world state (SIGTERM is handled)
KillSignal=SIGTERM
TimeoutStopSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now nexuspark
```

## 4. HTTPS / reverse proxy (recommended for the internet)

Voice chat (microphone) and some embeds require a **secure origin**, so put
any TLS proxy in front and forward WebSocket upgrades. The client
automatically uses `wss://` on https pages — no config needed.

**Caddy** (easiest — automatic certificates):

```
your-domain.example {
    reverse_proxy 127.0.0.1:8080
}
```

**Nginx**:

```nginx
server {
    listen 443 ssl;
    server_name your-domain.example;
    # ssl_certificate ...; ssl_certificate_key ...;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;     # WebSocket upgrade
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;                   # long-lived WS
    }
}
```

Keep `HOST=127.0.0.1` when behind a proxy so the Node port isn't exposed
directly.

## 5. Docker (optional)

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY . .
RUN npm ci && npm run build
ENV HOST=0.0.0.0 PORT=8080
VOLUME /app/server/data
EXPOSE 8080
CMD ["node", "server/dist/index.js"]
```

```bash
docker build -t nexuspark .
docker run -d -p 8080:8080 -v nexuspark-data:/app/server/data \
  -e JWT_SECRET=$(openssl rand -hex 48) nexuspark
```

## 6. Updating a live server

```bash
git pull
npm install
npm run build
sudo systemctl restart nexuspark   # SIGTERM → world state persisted first
```

Sessions survive restarts (JWTs stay valid as long as `JWT_SECRET`/
`server/data/jwt-secret` is unchanged); players auto-reconnect and are
restored to their last position.

## 7. Voice chat across strict NATs (optional)

P2P voice uses the STUN servers from `STUN_SERVERS`. If some users can't
hear each other (symmetric NAT), run a TURN server (e.g. coturn) and add its
`turn:` URL to `STUN_SERVERS` — credentials support would be a small edit in
`client/src/voice/voice.ts` (`iceServers` construction).

## 8. Capacity notes

A single process comfortably handles dozens of simultaneous players
(10 Hz snapshots per occupied space, tiny JSON payloads). CPU cost is
dominated by WebSocket serialization; SQLite is effectively free at this
scale. For hundreds+ of concurrent users you would shard spaces across
processes — the per-space design (`game/space.ts`) is the seam to cut along.
