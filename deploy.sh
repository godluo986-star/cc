#!/usr/bin/env bash
# ─── Nexus Park one-click deploy ─────────────────────────────────────────────
# Usage:
#   ./deploy.sh                # build + start in the foreground (dev/trial)
#   ./deploy.sh --daemon       # build + start detached (nohup, logs/server.log)
#   ./deploy.sh --systemd      # build + install & start a systemd service (needs sudo)
#   ./deploy.sh --stop         # stop a --daemon instance
# Everything stays inside this folder; delete the folder to remove the app.
set -euo pipefail
cd "$(dirname "$0")"

MODE="${1:-run}"

say() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }

if [[ "$MODE" == "--stop" ]]; then
  if [[ -f .server.pid ]] && kill -0 "$(cat .server.pid)" 2>/dev/null; then
    kill "$(cat .server.pid)" && rm -f .server.pid
    say "Server stopped."
  else
    say "No running --daemon instance found (.server.pid missing or stale)."
  fi
  exit 0
fi

# 1. Node version check
if ! command -v node >/dev/null; then
  echo "Node.js >= 20 is required (https://nodejs.org). Aborting." >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 20 )); then
  echo "Node.js >= 20 required, found $(node -v). Aborting." >&2
  exit 1
fi

# 2. Install + build
say "Installing dependencies (project-local)…"
npm install --no-audit --no-fund
say "Building client + server…"
npm run build

# 3. Environment bootstrap
if [[ ! -f .env ]]; then
  say "Creating .env with a generated JWT secret…"
  SECRET="$(node -e 'console.log(require("crypto").randomBytes(48).toString("hex"))')"
  {
    echo "PORT=${PORT:-8080}"
    echo "HOST=${HOST:-0.0.0.0}"
    echo "JWT_SECRET=${SECRET}"
  } > .env
  say "Wrote .env (HOST=0.0.0.0 so other devices on your network can join)."
fi

PORT_VAL="$(grep -E '^PORT=' .env | head -1 | cut -d= -f2)"
PORT_VAL="${PORT_VAL:-8080}"

# 4. Launch
case "$MODE" in
  --daemon)
    mkdir -p logs
    say "Starting detached… (logs/server.log)"
    nohup node server/dist/index.js > logs/server.log 2>&1 &
    echo $! > .server.pid
    sleep 1.5
    if curl -sf "http://127.0.0.1:${PORT_VAL}/healthz" >/dev/null 2>&1; then
      say "Nexus Park is up → http://<this-machine>:${PORT_VAL}   (stop with ./deploy.sh --stop)"
    else
      say "Started (pid $(cat .server.pid)) — check logs/server.log if it isn't reachable."
    fi
    ;;
  --systemd)
    if [[ "$(id -u)" -ne 0 ]] && ! command -v sudo >/dev/null; then
      echo "--systemd needs root or sudo." >&2; exit 1
    fi
    SUDO=""; [[ "$(id -u)" -ne 0 ]] && SUDO="sudo"
    APPDIR="$(pwd)"
    NODEBIN="$(command -v node)"
    say "Installing systemd unit nexuspark.service…"
    $SUDO tee /etc/systemd/system/nexuspark.service >/dev/null <<UNIT
[Unit]
Description=Nexus Park metaverse server
After=network.target

[Service]
WorkingDirectory=${APPDIR}
ExecStart=${NODEBIN} ${APPDIR}/server/dist/index.js
Restart=on-failure
KillSignal=SIGTERM
TimeoutStopSec=10

[Install]
WantedBy=multi-user.target
UNIT
    $SUDO systemctl daemon-reload
    $SUDO systemctl enable --now nexuspark
    say "Service running → http://<this-machine>:${PORT_VAL}   (journalctl -u nexuspark -f)"
    ;;
  *)
    say "Starting Nexus Park → http://localhost:${PORT_VAL}   (Ctrl-C to stop)"
    exec node server/dist/index.js
    ;;
esac
