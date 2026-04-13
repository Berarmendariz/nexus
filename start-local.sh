#!/bin/bash
# Start Nexus: backend (port 3002) + MiroFish (port 5001) + frontend (port 5174)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/../nexus-frontend"

# Kill stale processes
for port in 3002 5001 5174; do
  pid=$(lsof -ti:$port 2>/dev/null | head -1)
  if [ -n "$pid" ]; then
    echo "Killing stale process $pid on port $port"
    kill -9 $pid 2>/dev/null || true
  fi
done
sleep 1

# Start backend
echo ""
echo "🔷 Starting Nexus Backend (port 3002)..."
cd "$SCRIPT_DIR"
node server.js &
BACKEND_PID=$!

# Wait for backend
sleep 3
if curl -s http://localhost:3002/health > /dev/null 2>&1; then
  echo "   ✅ Backend running"
else
  echo "   ⚠️  Backend may still be starting..."
fi

# Start frontend
echo ""
echo "🔷 Starting Nexus Frontend (port 5174)..."
cd "$FRONTEND_DIR"
npx vite --port 5174 &
FRONTEND_PID=$!

sleep 3
echo ""
echo "╔══════════════════════════════════════╗"
echo "║         NEXUS — Running              ║"
echo "║                                      ║"
echo "║  Frontend: http://localhost:5174      ║"
echo "║  Backend:  http://localhost:3002      ║"
echo "║  MiroFish: http://localhost:5001      ║"
echo "║                                      ║"
echo "║  Simulador: http://localhost:5174/simulator"
echo "║                                      ║"
echo "╚══════════════════════════════════════╝"
echo ""
echo "Press Ctrl+C to stop all services"

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM
wait
