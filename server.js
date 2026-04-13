import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { registerSimulationRoutes } from './simulate.js'
import { getSimulation } from './simulationStore.js'
import { generatePDF } from './pdfGenerator.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Load .env with ABSOLUTE paths so it works regardless of cwd
dotenv.config({ path: path.join(__dirname, '.env.local'), override: false })
dotenv.config({ path: path.join(__dirname, '.env'), override: true })

const app = express()
const PORT = process.env.PORT || 3002

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:4173',
  'http://localhost:4174',
  process.env.FRONTEND_URL,
].filter(Boolean)

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.some(o => origin.startsWith(o))) return cb(null, true)
    if (origin.endsWith('.vercel.app')) return cb(null, true)
    cb(null, true)
  },
  credentials: true
}))
app.use(express.json({ limit: '10mb' }))

app.get('/health', (req, res) => {
  res.json({ service: 'Nexus Backend', version: '1.0.0', status: 'ok' })
})

const { registerMiroFishRoutes, startMiroFishBackend, stopMiroFishBackend } = await import('./mirofish-manager.js')
registerMiroFishRoutes(app)

// Register simulation, history, comparison routes
registerSimulationRoutes(app)

// More specific route first to avoid /api/simulations/:id catching /pdf
app.get('/api/simulations/:id/pdf', async (req, res) => {
  try {
    const sim = getSimulation(req.params.id)
    if (!sim) return res.status(404).json({ success: false, error: 'Simulation not found' })

    const pdfBuffer = await generatePDF(sim)
    const filename = `nexus-report-${sim.project?.name || 'simulation'}-${sim.id.slice(0, 8)}.pdf`
      .replace(/[^a-zA-Z0-9._-]/g, '_')

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': pdfBuffer.length,
    })
    res.send(pdfBuffer)
  } catch (err) {
    console.error('[PDF] Generation error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

app.post('/api/scenarios/compare', async (req, res) => {
  try {
    const { simulationIds } = req.body
    if (!Array.isArray(simulationIds) || simulationIds.length < 2) {
      return res.status(400).json({ success: false, error: 'At least 2 simulation IDs are required' })
    }

    const simulations = simulationIds.map(id => getSimulation(id)).filter(Boolean)
    if (simulations.length < 2) {
      return res.status(404).json({ success: false, error: 'Could not find at least 2 valid simulations' })
    }

    const kpiComparison = {}
    simulations.forEach(sim => {
      for (const kpi of (sim.report?.kpis || [])) {
        if (!kpiComparison[kpi.label]) kpiComparison[kpi.label] = []
        kpiComparison[kpi.label].push({
          simulationId: sim.id,
          projectName: sim.project?.name || 'Sin nombre',
          value: kpi.value,
          type: kpi.type || kpi.trend || 'neutral',
        })
      }
    })

    let aiSummary = null
    const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY
    if (apiKey) {
      try {
        const prompt = `Eres un analista de inversiones inmobiliarias. Compara los siguientes proyectos basándote en sus KPIs y genera un resumen ejecutivo de comparación en español. Sé concreto, profesional y útil.\n\n${simulations.map((sim, i) => `${i + 1}. ${sim.project?.name || 'Proyecto ' + (i + 1)}\n${(sim.report?.kpis || []).map(k => `- ${k.label}: ${k.value}`).join('\n')}`).join('\n\n')}\n\nEntrega:\n1. Hallazgos comparativos clave\n2. Fortalezas y debilidades de cada escenario\n3. Recomendación final`;

        const llmRes = await fetch(`${process.env.LLM_BASE_URL || 'https://api.openai.com/v1'}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: process.env.LLM_MODEL_NAME || 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 1200,
            temperature: 0.7,
          }),
        })

        if (llmRes.ok) {
          const llmData = await llmRes.json()
          aiSummary = llmData.choices?.[0]?.message?.content || null
        }
      } catch (err) {
        console.warn('[Compare] LLM summary failed:', err.message)
      }
    }

    res.json({
      success: true,
      data: {
        simulations: simulations.map(s => ({
          id: s.id,
          projectName: s.project?.name || 'Sin nombre',
          timestamp: s.timestamp,
          kpis: s.report?.kpis || [],
        })),
        kpiComparison,
        aiSummary,
      },
    })
  } catch (err) {
    console.error('[Compare] Error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

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

app.listen(PORT, async () => {
  console.log(`\n🔷 NEXUS BACKEND\n   http://localhost:${PORT}\n   🤖 MiroFish: POST /api/mirofish/start to launch\n  `)

  const ok = await startMiroFishBackend().catch(err => {
    console.warn('[Nexus] MiroFish auto-start failed:', err.message)
    return false
  })
  if (ok) console.log('   🤖 MiroFish: AUTO-STARTED\n')
  else console.log('   ⚠️  MiroFish: not started (POST /api/mirofish/start)\n')
})

process.on('SIGTERM', stopMiroFishBackend)
process.on('exit', stopMiroFishBackend)
