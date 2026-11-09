#!/usr/bin/env bash
# Runs the whole app locally: backend on http://localhost:8000, frontend on http://localhost:3000.
# Logs of both show here. Ctrl+C stops both; if one of them dies, the other is stopped too.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_PORT=8000
FRONTEND_PORT=3000 # the backend's CORS_ORIGINS and the Playwright config expect this port

# What listens on a port, e.g. "node (PID 123)"; empty when the port is free.
listening_on() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | awk 'NR > 1 { print $1 " (PID " $2 ")" }' | sort -u | paste -sd, - | sed 's/,/, /g'
}

busy=0
for port in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  who="$(listening_on "$port")"
  if [ -n "$who" ]; then
    echo "Port $port is already in use by: $who"
    busy=1
  fi
done
if [ "$busy" = 1 ]; then
  echo "Stop it first (kill <PID>), then run this again."
  exit 1
fi
if [ ! -x "$ROOT/backend/.venv/bin/uvicorn" ]; then
  echo "No backend virtualenv: cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
  exit 1
fi
if [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "No frontend packages: cd frontend && npm install"
  exit 1
fi

# npm and uvicorn --reload start child processes, so stop the whole tree.
kill_tree() {
  local child
  for child in $(pgrep -P "$1"); do kill_tree "$child"; done
  kill "$1" 2>/dev/null
}

pids=()
stopping=0
stop_all() {
  [ "$stopping" = 1 ] && return
  stopping=1
  echo
  echo "Stopping the servers..."
  local pid
  for pid in "${pids[@]}"; do kill_tree "$pid"; done
  wait 2>/dev/null
}
trap stop_all EXIT
trap 'exit 130' INT TERM

(cd "$ROOT/backend" && exec .venv/bin/uvicorn app.main:app --reload --port "$BACKEND_PORT") &
pids+=($!)
(cd "$ROOT/frontend" && exec npm run dev -- --port "$FRONTEND_PORT") &
pids+=($!)

echo "Backend:  http://localhost:$BACKEND_PORT"
echo "Frontend: http://localhost:$FRONTEND_PORT   (Ctrl+C stops both)"

# macOS ships bash 3.2 without `wait -n`, so check every second whether one of them has exited.
while true; do
  for pid in "${pids[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "A server exited; stopping the other one."
      exit 1
    fi
  done
  sleep 1
done
