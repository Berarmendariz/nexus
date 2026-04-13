import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Load .env with ABSOLUTE paths so it works regardless of cwd
dotenv.config({ path: path.join(__dirname, '.env.local'), override: false })
dotenv.config({ path: path.join(__dirname, '.env'), override: true })

const app = express()
const PORT = process.env.PORT || 3002

// CORS: allow localhost (dev) + any Vercel/custom frontend (prod)
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:4173',
  'http://localhost:4174',
  process.env.FRONTEND_URL,        // set in Railway
].filter(Boolean)
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.some(o => origin.startsWith(o))) return cb(null, true)
    // Also allow any *.vercel.app subdomain
    if (origin.endsWith('.vercel.app')) return cb(null, true)
    cb(null, true) // permissive for now — lock down later
  },
  credentials: true
}))
app.use(express.json({ limit: '10mb' }))

// Health check
app.get('/health', (req, res) => {
  res.json({ service: 'Nexus Backend', version: '1.0.0', status: 'ok' })
})

// Register MiroFish proxy routes (/api/mirofish/*)
// Loaded dynamically so dotenv is already applied
const { registerMiroFishRoutes, startMiroFishBackend, stopMiroFishBackend } = await import('./mirofish-manager.js')
registerMiroFishRoutes(app)

// In-memory project store
const projects = new Map()

app.post('/api/projects', (req, res) => {
  const { name, description, location, type, units, area, priceRange } = req.body
  if (!name || !description) {
    return res.status(400).json({ success: false, error: 'name and description are required' })
  }
  const id = `proj_${Date.now()}`
  const project = { id, name, description, location, type, units, area, priceRange, createdAt: new Date().toISOString() }
  projects.set(id, project)
  res.json({ success: true, data: project })
})

app.get('/api/projects', (req, res) => {
  res.json({ success: true, data: Array.from(projects.values()) })
})

app.get('/api/projects/:id', (req, res) => {
  const project = projects.get(req.params.id)
  if (!project) return res.status(404).json({ success: false, error: 'Project not found' })
  res.json({ success: true, data: project })
})

// Start server
app.listen(PORT, async () => {
  console.log(`
🔷 NEXUS BACKEND
   http://localhost:${PORT}
   🤖 MiroFish: POST /api/mirofish/start to launch
  `)

  // Auto-start MiroFish
  const ok = await startMiroFishBackend().catch(err => {
    console.warn('[Nexus] MiroFish auto-start failed:', err.message)
    return false
  })
  if (ok) console.log('   🤖 MiroFish: AUTO-STARTED\n')
  else console.log('   ⚠️  MiroFish: not started (POST /api/mirofish/start)\n')
})

process.on('SIGTERM', stopMiroFishBackend)
process.on('exit', stopMiroFishBackend)
