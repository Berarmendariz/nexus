#!/bin/bash
set -e
cd /home/ubuntu/.openclaw/workspace/nexus

# Kill any existing server on 3002
fuser -k 3002/tcp 2>/dev/null || true
sleep 1

# Start server in background
PORT=3002 node server.js &
SERVER_PID=$!
sleep 8

echo "=== HEALTH ==="
curl -s http://localhost:3002/health
echo ""

echo "=== SIMULATIONS LIST (empty) ==="
curl -s http://localhost:3002/api/simulations
echo ""

echo "=== SIMULATE (no body - 400) ==="
curl -s -X POST http://localhost:3002/api/simulate \
  -H "Content-Type: application/json" \
  -d '{}'
echo ""

echo "=== REPORT/GENERATE (no body - 400) ==="
curl -s -X POST http://localhost:3002/api/report/generate \
  -H "Content-Type: application/json" \
  -d '{}'
echo ""

echo "=== SSE SIMULATE (with project) ==="
curl -s -N -X POST http://localhost:3002/api/simulate \
  -H "Content-Type: application/json" \
  -d '{
    "project": {
      "name": "Torre Reforma Norte",
      "description": "20-story mixed-use tower in Polanco, Mexico City with 120 luxury apartments and 3 commercial floors.",
      "location": "Polanco, CDMX",
      "type": "Mixed-use tower",
      "units": 120
    },
    "question": "Is this a good 5-year investment?"
  }' --max-time 90
echo ""

echo ""
echo "=== DONE ==="
kill $SERVER_PID 2>/dev/null || true
