/**
 * MiroFish Process Manager
 * Spawns and manages the MiroFish Python Flask backend as a subprocess.
 *
 * Architecture:
 *   Express (port 3001) proxies /api/mirofish/* → Flask (port 5001)
 *   The Flask backend handles: ontology, graph, simulation, reports (OASIS/Zep)
 */

import { spawn } from 'child_process';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// this file lives inside nexus/
const PROJECT_ROOT = path.resolve(__dirname);
const MIROFISH_BACKEND = path.join(PROJECT_ROOT, 'mirofish-backend');
const MIROFISH_VENV_PYTHON = path.join(PROJECT_ROOT, '.mirofish-venv', 'bin', 'python');
const FLASK_PORT = parseInt(process.env.MIROFISH_PORT || '5001');
const FLASK_HOST = process.env.MIROFISH_HOST || '127.0.0.1';
const STARTUP_TIMEOUT_MS = 30000;
const HEALTH_CHECK_INTERVAL_MS = 30000;

let flaskProcess = null;
let flaskReady = false;
let flaskCheckInterval = null;

/** Check if Flask is alive via HTTP */
function checkFlaskHealth() {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: FLASK_HOST, port: FLASK_PORT, path: '/health', method: 'GET', timeout: 5000 },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json.status === 'ok');
          } catch {
            resolve(false);
          }
        });
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

/** Wait for Flask to be ready */
async function waitForFlask(timeoutMs = STARTUP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await checkFlaskHealth();
    if (ok) { flaskReady = true; return true; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

/** Start MiroFish Flask backend as subprocess */
export async function startMiroFishBackend() {
  if (flaskProcess) {
    const ok = await checkFlaskHealth();
    if (ok) { console.log('[MiroFish] Already running'); return true; }
    console.log('[MiroFish] Process exists but unhealthy, restarting...');
    stopMiroFishBackend();
  }

  console.log(`[MiroFish] Starting Flask on ${FLASK_HOST}:${FLASK_PORT}`);
  console.log(`[MiroFish] Python: ${MIROFISH_VENV_PYTHON}`);
  console.log(`[MiroFish] Backend: ${MIROFISH_BACKEND}`);

  // Derive MiroFish env vars from PropValuer's .env.local
  // MiroFish reads: LLM_API_KEY, LLM_BASE_URL, LLM_MODEL_NAME, ZEP_API_KEY, FLASK_DEBUG
  const pythonEnv = {
    ...process.env,
    // MiroFish LLM config — prefer PropValuer's OpenAI key
    LLM_API_KEY:       process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || '',
    LLM_BASE_URL:      process.env.LLM_BASE_URL   || 'https://api.openai.com/v1',
    LLM_MODEL_NAME:    process.env.LLM_MODEL_NAME || 'gpt-4o-mini',
    // Zep memory graph
    ZEP_API_KEY:       process.env.ZEP_API_KEY || '',
    // Flask config
    FLASK_PORT:        String(FLASK_PORT),
    FLASK_HOST,
    FLASK_DEBUG:        'false',
    PYTHONUNBUFFERED:  '1',
  };

  // Validate required keys before spawning
  if (!pythonEnv.LLM_API_KEY) {
    console.warn('[MiroFish] WARNING: LLM_API_KEY not set — Flask will exit with config error.');
    console.warn('[MiroFish] Set OPENAI_API_KEY in .env.local or pass LLM_API_KEY directly.');
  }
  if (!pythonEnv.ZEP_API_KEY) {
    console.warn('[MiroFish] WARNING: ZEP_API_KEY not set — Zep memory features will be disabled.');
  }

  flaskProcess = spawn(MIROFISH_VENV_PYTHON, ['run.py'], {
    cwd: MIROFISH_BACKEND,
    env: pythonEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  flaskProcess.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach((line) => {
      if (line) console.log(`[MiroFish] ${line}`);
    });
  });

  flaskProcess.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach((line) => {
      if (line) console.warn(`[MiroFish:err] ${line}`);
    });
  });

  flaskProcess.on('exit', (code) => {
    console.warn(`[MiroFish] Process exited code=${code}`);
    flaskProcess = null;
    flaskReady = false;
  });

  flaskProcess.on('error', (err) => {
    console.error(`[MiroFish] Spawn error: ${err.message}`);
    flaskProcess = null;
  });

  const ready = await waitForFlask();
  if (ready) {
    console.log(`[MiroFish] Backend ready at ${FLASK_HOST}:${FLASK_PORT}`);
    flaskReady = true;
    return true;
  } else {
    console.error('[MiroFish] Backend failed to start within timeout');
    return false;
  }
}

/** Stop MiroFish Flask backend */
export function stopMiroFishBackend() {
  if (flaskCheckInterval) { clearInterval(flaskCheckInterval); flaskCheckInterval = null; }
  if (flaskProcess) {
    console.log('[MiroFish] Stopping Flask...');
    flaskProcess.kill('SIGTERM');
    flaskProcess = null;
    flaskReady = false;
  }
}

/** Check if MiroFish is running */
export function isMiroFishReady() { return flaskReady; }

/** Get Flask URL */
export function getMiroFishUrl() { return `http://${FLASK_HOST}:${FLASK_PORT}`; }

/** Proxy an incoming Express request to Flask */
export async function proxyToMiroFish(req, res) {
  if (!flaskReady) {
    return res.status(503).json({
      success: false,
      error: 'MiroFish backend is not running. POST /api/mirofish/start to launch it.',
      docs: 'GET /api/mirofish/status'
    });
  }

  const urlPath = req.url.replace(/^\/api\/mirofish/, '') || '/';
  const method = req.method.toUpperCase();

  const options = {
    hostname: FLASK_HOST,
    port: FLASK_PORT,
    path: urlPath,
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-By': 'PropValuer-Proxy',
    },
    timeout: 120000,
  };

  return new Promise((resolve) => {
    const proxyReq = http.request(options, (proxyRes) => {
      res.status(proxyRes.statusCode || 200);
      proxyRes.headers['x-mirofish-proxy'] = 'true';
      Object.entries(proxyRes.headers).forEach(([k, v]) => {
        if (v) res.setHeader(k, v);
      });
      proxyRes.pipe(res);
      proxyRes.on('end', resolve);
    });

    proxyReq.on('error', (err) => {
      console.error(`[MiroFish Proxy] ${method} ${urlPath} — error: ${err.message}`);
      if (!res.headersSent) {
        res.status(502).json({ success: false, error: `MiroFish unreachable: ${err.message}` });
      }
      resolve();
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      if (!res.headersSent) res.status(504).json({ success: false, error: 'MiroFish request timeout' });
      resolve();
    });

    if (['POST', 'PUT', 'PATCH'].includes(method) && req.body) {
      proxyReq.write(JSON.stringify(req.body));
    }
    proxyReq.end();
  });
}

/** Register MiroFish management routes on an Express app */
export function registerMiroFishRoutes(app) {
  app.get('/api/mirofish/status', async (req, res) => {
    const healthy = await checkFlaskHealth();
    res.json({
      success: true,
      data: {
        running: healthy,
        ready: flaskReady,
        url: getMiroFishUrl(),
        pid: flaskProcess?.pid || null,
        message: healthy
          ? 'MiroFish backend is running'
          : flaskProcess
          ? 'Process exists but not responding'
          : 'MiroFish backend is not started',
      }
    });
  });

  app.post('/api/mirofish/start', async (req, res) => {
    if (flaskReady) {
      return res.json({ success: true, data: { started: false, message: 'Already running', url: getMiroFishUrl() } });
    }
    res.json({ success: true, data: { started: true, message: 'Starting MiroFish backend...' } });
    await startMiroFishBackend();
  });

  app.post('/api/mirofish/stop', (req, res) => {
    stopMiroFishBackend();
    res.json({ success: true, data: { stopped: true } });
  });

  // Catch-all proxy for /api/mirofish/*
  app.use('/api/mirofish', (req, res) => proxyToMiroFish(req, res));
}

/** Start periodic health-check loop */
export function startHealthCheck() {
  if (flaskCheckInterval) return;
  flaskCheckInterval = setInterval(async () => {
    if (flaskProcess && !flaskReady) {
      const ok = await checkFlaskHealth();
      if (ok) { flaskReady = true; console.log('[MiroFish] Health check recovered'); }
    }
  }, HEALTH_CHECK_INTERVAL_MS);
}

process.on('SIGTERM', stopMiroFishBackend);
process.on('exit', stopMiroFishBackend);
