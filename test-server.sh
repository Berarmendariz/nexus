#!/bin/bash
cd /home/ubuntu/.openclaw/workspace/nexus
fuser -k 3002/tcp 2>/dev/null
sleep 1
PORT=3099 node server.js &
SERVER_PID=$!
sleep 6

echo "=== HEALTH ==="
curl -s http://localhost:3099/health
echo ""

echo "=== SIMULATE (no body - should 400) ==="
curl -s -X POST http://localhost:3099/api/simulate -H "Content-Type: application/json" -d '{}'
echo ""

echo "=== REPORT (no body - should 400) ==="
curl -s -X POST http://localhost:3099/api/report/generate -H "Content-Type: application/json" -d '{}'
echo ""

echo "=== SIMULATIONS LIST ==="
curl -s http://localhost:3099/api/simulations
echo ""

echo "=== SIMULATE (with data - SSE) ==="
curl -s -N -X POST http://localhost:3099/api/simulate \
  -H "Content-Type: application/json" \
  -d '{"project":{"name":"Torre Reforma Norte","description":"20-story mixed-use tower in Polanco, Mexico City. 120 luxury apartments plus 3 floors of commercial space. Near Chapultepec park.","location":"Polanco, CDMX","type":"Mixed-use tower","units":120},"question":"Is this a good investment for a 5-year horizon?"}' \
  --max-time 60
echo ""

kill $SERVER_PID 2>/dev/null
echo "=== DONE ==="
