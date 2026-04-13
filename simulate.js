/**
 * simulate.js — SSE streaming simulation endpoint + report generation
 *
 * POST /api/simulate  (SSE stream)
 *   Body: { project: {name, location, type, units, area, priceRange}, question: string }
 *   Events: status, agent_activity, report, error, done
 *
 * GET  /api/simulations       — list history
 * GET  /api/simulations/:id   — get one
 * DELETE /api/simulations/:id — delete
 * POST /api/scenarios/compare — compare multiple simulations
 */

import { listSimulations, getSimulation, saveSimulation, deleteSimulation } from './simulationStore.js'

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

function getApiKey() {
  return process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || ''
}

function getModel() {
  return process.env.LLM_MODEL_NAME || 'gpt-4o-mini'
}

/** Call OpenAI and return parsed JSON */
async function callLLM(messages, { temperature = 0.7, max_tokens = 3000 } = {}) {
  const key = getApiKey()
  if (!key) throw new Error('No LLM API key configured')

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: getModel(), messages, temperature, max_tokens }),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`OpenAI ${res.status}: ${txt.slice(0, 200)}`)
  }
  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

/** Try to parse JSON from LLM output (handles ```json blocks) */
function parseJSON(text) {
  // Strip markdown code fences
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
  return JSON.parse(clean)
}

// ── Agent profiles ──────────────────────────────────
const AGENT_PROFILES = [
  { name: 'Carlos Medina', role: 'Inversionista Ángel', emoji: '💰', color: '#22c55e', style: 'Analiza ROI, riesgo y estructura de capital' },
  { name: 'Ana Reyes', role: 'Analista de Mercado', emoji: '📊', color: '#3b82f6', style: 'Datos duros, comparables, tendencias de zona' },
  { name: 'Roberto Fuentes', role: 'Comprador Potencial', emoji: '🏠', color: '#f59e0b', style: 'Perspectiva del usuario final, necesidades, precio justo' },
  { name: 'Daniela Torres', role: 'Urbanista', emoji: '🏗️', color: '#8b5cf6', style: 'Infraestructura, conectividad, regulación urbana' },
  { name: 'Miguel Ángel Ruiz', role: 'Periodista Financiero', emoji: '📰', color: '#ef4444', style: 'Noticias del sector, señales macro, tendencias' },
  { name: 'Sofía Castañeda', role: 'Broker Inmobiliaria', emoji: '🔑', color: '#06b6d4', style: 'Absorción, pricing estratégico, perfil de demanda' },
]

/** Generate simulated agent activities using LLM */
async function generateAgentActivities(project, question, sendEvent) {
  const totalRounds = 6
  const activities = []

  sendEvent('status', { phase: 'creating_agents', message: 'Creando perfiles de agentes especializados...' })
  await sleep(800)

  // Introduce agents
  for (const agent of AGENT_PROFILES) {
    sendEvent('agent_activity', {
      agent: agent.name, role: agent.role, emoji: agent.emoji, color: agent.color,
      action: 'join', content: `${agent.emoji} ${agent.name} se une como ${agent.role}`, round: 0,
    })
    await sleep(300)
  }

  sendEvent('status', { phase: 'simulating', message: 'Iniciando simulación con agentes OASIS...', totalRounds })

  // Generate all rounds of discussion via LLM
  const prompt = `Eres un director de simulación de inversiones inmobiliarias. Genera una discusión realista entre 6 agentes especializados analizando un proyecto.

PROYECTO:
- Nombre: ${project.name || 'Proyecto Inmobiliario'}
- Ubicación: ${project.location || 'México'}
- Tipo: ${project.type || 'residencial'}
- Unidades: ${project.units || 'N/A'}
- Área por unidad: ${project.area || 'N/A'} m²
- Rango de precio: ${project.priceRange || 'N/A'}

PREGUNTA DEL USUARIO: ${question}

AGENTES:
${AGENT_PROFILES.map((a, i) => `${i + 1}. ${a.name} (${a.role}) — ${a.style}`).join('\n')}

Genera exactamente ${totalRounds} rondas de discusión. En cada ronda, 2-4 agentes participan con acciones variadas.

Responde SOLO en JSON válido con esta estructura:
{
  "rounds": [
    {
      "round": 1,
      "activities": [
        {"agent_index": 0, "action": "post", "content": "texto de la contribución"},
        {"agent_index": 1, "action": "analysis", "content": "texto del análisis"},
        {"agent_index": 2, "action": "reply", "content": "texto de la respuesta"}
      ]
    }
  ]
}

Acciones válidas: post, analysis, reply, like, repost
Contenido en español, profesional, con datos específicos y opiniones contrastantes. Cada mensaje 1-3 oraciones máximo.`

  try {
    const rawResponse = await callLLM([{ role: 'user', content: prompt }], { temperature: 0.8, max_tokens: 4000 })
    const parsed = parseJSON(rawResponse)

    for (const round of (parsed.rounds || [])) {
      sendEvent('status', { phase: 'simulating', message: `Ronda ${round.round} de ${totalRounds}...`, round: round.round, totalRounds })
      
      for (const act of (round.activities || [])) {
        const agent = AGENT_PROFILES[act.agent_index] || AGENT_PROFILES[0]
        const activity = {
          agent: agent.name, role: agent.role, emoji: agent.emoji, color: agent.color,
          action: act.action || 'post', content: act.content, round: round.round,
        }
        activities.push(activity)
        sendEvent('agent_activity', activity)
        await sleep(600 + Math.random() * 400)
      }
      await sleep(500)
    }
  } catch (err) {
    console.warn('[Simulate] LLM agent generation failed, using procedural fallback:', err.message)
    // Fallback: generate basic activities without LLM
    for (let r = 1; r <= totalRounds; r++) {
      sendEvent('status', { phase: 'simulating', message: `Ronda ${r} de ${totalRounds}...`, round: r, totalRounds })
      const shuffled = [...AGENT_PROFILES].sort(() => Math.random() - 0.5).slice(0, 3)
      for (const agent of shuffled) {
        const activity = {
          agent: agent.name, role: agent.role, emoji: agent.emoji, color: agent.color,
          action: 'analysis', content: `Analizando ${project.name || 'el proyecto'} desde perspectiva de ${agent.role.toLowerCase()}...`, round: r,
        }
        activities.push(activity)
        sendEvent('agent_activity', activity)
        await sleep(400)
      }
    }
  }

  return activities
}

/** Generate a structured report from the simulation */
async function generateReport(project, question, activities) {
  const activitySummary = activities
    .filter(a => a.action !== 'join' && a.action !== 'like')
    .map(a => `[${a.role}] ${a.content}`)
    .join('\n')

  const prompt = `Eres un analista inmobiliario senior. Basándote en la simulación de agentes de IA, genera un reporte ejecutivo estructurado.

PROYECTO:
- Nombre: ${project.name || 'Proyecto Inmobiliario'}
- Ubicación: ${project.location || 'México'}
- Tipo: ${project.type || 'residencial'}
- Unidades: ${project.units || 'N/A'}
- Área por unidad: ${project.area || 'N/A'} m²
- Rango de precio: ${project.priceRange || 'N/A'}

PREGUNTA: ${question}

DISCUSIÓN DE AGENTES:
${activitySummary.slice(0, 3000)}

Genera un reporte SOLO en JSON válido con esta estructura exacta:
{
  "badge": "Tipo de Reporte (ej: Análisis de Viabilidad)",
  "engine": "Nexus OASIS Simulation",
  "kpis": [
    {"label": "nombre del KPI", "value": "valor con unidad", "type": "positive|negative|neutral"}
  ],
  "sections": [
    {"title": "Título de sección", "items": ["punto 1", "punto 2", "punto 3"]},
    {"title": "Conclusión", "text": "párrafo de conclusión"}
  ]
}

Reglas:
- Genera 5-6 KPIs relevantes con valores ESPECÍFICOS y realistas para México
- Genera 4-5 secciones de análisis
- Última sección siempre es "Conclusión" con campo "text" en vez de "items"
- Todo en español
- Sé específico con números, porcentajes, plazos
- Basa el análisis en lo que discutieron los agentes`

  const rawResponse = await callLLM([{ role: 'user', content: prompt }], { temperature: 0.5, max_tokens: 2500 })
  return parseJSON(rawResponse)
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

/** Register all simulation + history routes */
export function registerSimulationRoutes(app) {

  // ── SSE Streaming Simulation ──
  app.post('/api/simulate', async (req, res) => {
    const { project = {}, question = '' } = req.body
    if (!question.trim()) {
      return res.status(400).json({ success: false, error: 'question is required' })
    }

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const sendEvent = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    const simId = `sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    try {
      sendEvent('status', { phase: 'initializing', message: 'Inicializando simulación Nexus...', simulationId: simId })

      // Phase 1: Agent simulation
      const activities = await generateAgentActivities(project, question, sendEvent)

      // Phase 2: Report generation
      sendEvent('status', { phase: 'generating_report', message: 'Generando reporte ejecutivo con IA...' })

      let report
      try {
        report = await generateReport(project, question, activities)
      } catch (err) {
        console.error('[Simulate] Report generation failed:', err.message)
        // Minimal fallback report
        report = {
          badge: 'Reporte de Simulación',
          engine: 'Nexus OASIS',
          kpis: [
            { label: 'Estado', value: 'Simulación completada', type: 'neutral' },
            { label: 'Agentes', value: `${AGENT_PROFILES.length} participantes`, type: 'positive' },
          ],
          sections: [
            { title: 'Resumen', items: activities.filter(a => a.action !== 'join').slice(0, 5).map(a => `${a.role}: ${a.content}`) },
            { title: 'Conclusión', text: 'La simulación se completó pero no se pudo generar un análisis detallado. Intenta de nuevo.' },
          ],
        }
      }

      // Save to history
      const sim = {
        id: simId,
        project,
        question,
        timestamp: new Date().toISOString(),
        status: 'completed',
        activitiesCount: activities.length,
        report,
      }
      saveSimulation(sim)

      sendEvent('report', report)
      sendEvent('done', { simulationId: simId })
    } catch (err) {
      console.error('[Simulate] Fatal error:', err)
      sendEvent('error', { message: err.message || 'Simulation failed' })
    } finally {
      res.end()
    }
  })

  // ── History CRUD ──
  app.get('/api/simulations', (req, res) => {
    const sims = listSimulations().map(s => ({
      id: s.id, project: s.project, question: s.question,
      timestamp: s.timestamp, status: s.status,
      kpis: s.report?.kpis?.slice(0, 3) || [],
    }))
    res.json({ success: true, data: sims })
  })

  app.get('/api/simulations/:id', (req, res) => {
    const sim = getSimulation(req.params.id)
    if (!sim) return res.status(404).json({ success: false, error: 'Not found' })
    res.json({ success: true, data: sim })
  })

  app.delete('/api/simulations/:id', (req, res) => {
    const ok = deleteSimulation(req.params.id)
    if (!ok) return res.status(404).json({ success: false, error: 'Not found' })
    res.json({ success: true })
  })

  // ── Scenario Comparison ──
  app.post('/api/scenarios/compare', async (req, res) => {
    const { simulationIds } = req.body
    if (!simulationIds || !Array.isArray(simulationIds) || simulationIds.length < 2) {
      return res.status(400).json({ success: false, error: 'At least 2 simulation IDs required' })
    }

    const sims = simulationIds.map(id => getSimulation(id)).filter(Boolean)
    if (sims.length < 2) return res.status(404).json({ success: false, error: 'Could not find enough simulations' })

    // Build comparison
    const kpiMatrix = {}
    sims.forEach(sim => {
      (sim.report?.kpis || []).forEach(kpi => {
        if (!kpiMatrix[kpi.label]) kpiMatrix[kpi.label] = []
        kpiMatrix[kpi.label].push({ simId: sim.id, project: sim.project?.name, value: kpi.value, type: kpi.type })
      })
    })

    // LLM comparison
    let aiSummary = null
    try {
      const prompt = `Compara estos proyectos inmobiliarios y da una recomendación clara en español:\n\n${sims.map((s, i) => {
        const kpis = (s.report?.kpis || []).map(k => `  ${k.label}: ${k.value}`).join('\n')
        return `Proyecto ${i + 1}: ${s.project?.name || 'Sin nombre'}\n${kpis}`
      }).join('\n\n')}\n\nDa: 1) Tabla comparativa 2) Fortalezas/debilidades 3) Recomendación final`
      aiSummary = await callLLM([{ role: 'user', content: prompt }], { max_tokens: 1500 })
    } catch (e) { console.warn('[Compare] LLM failed:', e.message) }

    res.json({
      success: true,
      data: {
        simulations: sims.map(s => ({ id: s.id, project: s.project, timestamp: s.timestamp, kpis: s.report?.kpis || [] })),
        kpiMatrix,
        aiSummary,
      },
    })
  })
}
