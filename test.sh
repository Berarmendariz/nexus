#!/bin/bash
set -e

cd /home/ubuntu/.openclaw/workspace/nexus

# Start server in background
node server.js &
SERVER_PID=$!

# Wait for server to be ready
sleep 4

echo "=== Health Check ==="
curl -s http://localhost:3001/health
echo ""

echo "=== MiroFish Status ==="
curl -s http://localhost:3001/api/mirofish/status
echo ""

echo "=== Projects List ==="
curl -s http://localhost:3001/api/projects
echo ""

echo "=== Create Project ==="
curl -s -X POST http://localhost:3001/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name":"Torre Nexus","description":"Mixed-use tower in Polanco","location":"CDMX","type":"mixed","units":120,"area":8500}'
echo ""

echo "=== Projects After Create ==="
curl -s http://localhost:3001/api/projects
echo ""

# Cleanup
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true
echo "=== TESTS COMPLETE ==="
