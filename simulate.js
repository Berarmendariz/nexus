/**
 * simulate.js — SSE streaming simulation endpoint + report generation
 * 
 * Generates a full ecosystem of 70+ agents:
 *   - 6 expert analysts (fixed roles)
 *   - 10-15 investors (angel, institutional, family office, FIBRA, etc.)  
 *   - 40+ potential buyers (compradores potenciales) with varied intent
 *   - Supporting: architects, lawyers, urbanists, marketers
 * 
 * POST /api/simulate  (SSE stream)
 *   Body: { project: {name, location, type, units, area, priceRange}, question: string }
 *   Events: status, agents, agent_activity, report, error, done
 */

import { listSimulations, getSimulation, saveSimulation, deleteSimulation } from './simulationStore.js'
import { getAllAgentContext } from './supabase-rag.js'

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

function getApiKey() {
  return process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || ''
}

function getModel() {
  return process.env.LLM_MODEL_NAME || 'gpt-4o-mini'
}

async function callLLM(messages, { temperature = 0.7, max_tokens = 4000 } = {}) {
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

function parseJSON(text) {
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
  return JSON.parse(clean)
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ── Fixed expert agents ──
const EXPERT_AGENTS = [
  { name: 'Carlos Medina', role: 'Inversionista Ángel', emoji: '💰', color: '#22c55e', type: 'expert', style: 'Analiza ROI, riesgo y estructura de capital con enfoque en rendimientos superiores al mercado' },
  { name: 'Ana Reyes', role: 'Analista de Mercado', emoji: '📊', color: '#3b82f6', type: 'expert', style: 'Datos duros, comparables, tendencias de zona y métricas de absorción' },
  { name: 'Daniela Torres', role: 'Urbanista', emoji: '🏗️', color: '#8b5cf6', type: 'expert', style: 'Infraestructura, conectividad, regulación urbana y densificación' },
  { name: 'Miguel Ángel Ruiz', role: 'Periodista Financiero', emoji: '📰', color: '#ef4444', type: 'expert', style: 'Noticias del sector, señales macro, tendencias y narrativa pública' },
  { name: 'Sofía Castañeda', role: 'Broker Inmobiliaria', emoji: '🔑', color: '#06b6d4', type: 'expert', style: 'Absorción de mercado, pricing estratégico y perfil de demanda real' },
  { name: 'Fernando Leal', role: 'Arquitecto Senior', emoji: '📐', color: '#10b981', type: 'expert', style: 'Diseño, costos de construcción, eficiencia estructural y valor percibido' },
]

/** Generate dynamic agents based on project context using GPT */
async function generateDynamicAgents(project, question, units) {
  const numUnits = parseInt(units) || 40
  const numInvestors = Math.min(15, Math.max(8, Math.floor(numUnits * 0.2)))
  const numBuyers = Math.min(50, Math.max(20, numUnits + Math.floor(numUnits * 0.75)))

  const prompt = `Eres un director de simulación inmobiliaria. Genera perfiles realistas de agentes para analizar este proyecto.

PROYECTO: ${project.name || 'Proyecto Inmobiliario'} en ${project.location || 'México'}
Tipo: ${project.type || 'residencial'} | Unidades: ${numUnits} | Precio: ${project.priceRange || 'mercado'}
Pregunta: ${question}

Genera EXACTAMENTE:
- ${numInvestors} inversionistas con distintos perfiles (ángel, familiar, FIBRA, institucional, crowdfunding, extranjero)
- ${numBuyers} compradores potenciales con intent VARIADO: aprox ${Math.round(numBuyers*0.4)} compran, ${Math.round(numBuyers*0.35)} están considerando, ${Math.round(numBuyers*0.25)} no compran

Para inversionistas incluye: name, role, emoji, style, profile (2 oraciones de quién es)
Para compradores incluye: name, role, emoji, style, profile, intent (buying|considering|notbuying), budget (MXN), motivations (array de 2-3 razones)

Usa nombres mexicanos realistas y variados. Emojis únicos por persona.

Responde SOLO JSON válido:
{
  "investors": [
    {"name": "...", "role": "...", "emoji": "...", "style": "...", "profile": "..."}
  ],
  "buyers": [
    {"name": "...", "role": "...", "emoji": "...", "style": "...", "profile": "...", "intent": "buying|considering|notbuying", "budget": 0000000, "motivations": ["..."]}
  ]
}`

  try {
    const raw = await callLLM([{ role: 'user', content: prompt }], { temperature: 0.9, max_tokens: 6000 })
    const parsed = parseJSON(raw)
    
    const investors = (parsed.investors || []).map(a => ({
      ...a, type: 'investor', color: '#22c55e',
    }))
    const buyers = (parsed.buyers || []).map(a => ({
      ...a, type: 'buyer',
      color: a.intent === 'buying' ? '#22c55e' : a.intent === 'considering' ? '#f59e0b' : '#ef4444',
    }))
    
    return { investors, buyers }
  } catch (err) {
    console.warn('[Simulate] Dynamic agent generation failed, using fallback:', err.message)
    // Fallback buyers
    const intents = ['buying', 'buying', 'considering', 'notbuying']
    const buyerFallback = Array.from({ length: Math.min(20, numBuyers) }, (_, i) => ({
      name: `Cliente ${i + 1}`,
      role: 'Comprador Potencial',
      emoji: '🏠',
      type: 'buyer',
      style: 'Evalúa la compra desde perspectiva familiar',
      profile: 'Profesionista de clase media buscando su primera propiedad.',
      intent: intents[i % intents.length],
      budget: 3000000 + Math.floor(Math.random() * 5000000),
      motivations: ['Inversión patrimonial', 'Espacio propio'],
      color: '#f59e0b',
    }))
    return { investors: [], buyers: buyerFallback }
  }
}

/** Generate agent debates and interactions */
async function generateAgentActivities(allAgents, project, question, sendEvent, ragContext = {}) {
  const totalRounds = 8
  const activities = []

  sendEvent('status', { phase: 'creating_agents', message: 'Creando ecosistema de agentes...' })

  // Introduce all agents in batches
  const introOrder = [
    ...allAgents.filter(a => a.type === 'expert'),
    ...allAgents.filter(a => a.type === 'investor').slice(0, 5),
    ...allAgents.filter(a => a.type === 'buyer').slice(0, 8),
  ]
  for (const agent of introOrder) {
    sendEvent('agent_activity', {
      agent: agent.name, role: agent.role, emoji: agent.emoji, color: agent.color,
      action: 'join', content: `${agent.emoji} ${agent.name} se une como ${agent.role}`, round: 0,
      agentData: agent,
    })
    await sleep(120)
  }

  sendEvent('status', { phase: 'simulating', message: 'Iniciando debate entre agentes...', totalRounds })

  // Build expert + select investor participation for debate
  const debateAgents = [
    ...allAgents.filter(a => a.type === 'expert'),
    ...allAgents.filter(a => a.type === 'investor').slice(0, 4),
    ...allAgents.filter(a => a.type === 'buyer').slice(0, 3),
  ]

  const buyingCount = allAgents.filter(a => a.type === 'buyer' && a.intent === 'buying').length
  const consideringCount = allAgents.filter(a => a.type === 'buyer' && a.intent === 'considering').length
  const notBuyingCount = allAgents.filter(a => a.type === 'buyer' && a.intent === 'notbuying').length

  // Build RAG injection block
  const ragBlock = [
    ragContext.market,
    ragContext.financial,
    ragContext.legal,
    ragContext.buyer,
  ].filter(Boolean).join('\n\n')

  const prompt = `Eres director de simulación de inversiones. Genera un debate profundo y realista entre estos agentes analizando el proyecto.

PROYECTO:
- Nombre: ${project.name || 'Proyecto'}, Ubicación: ${project.location || 'México'}
- Tipo: ${project.type || 'residencial'}, Unidades: ${project.units || 'N/A'}, Precio: ${project.priceRange || 'N/A'}

PREGUNTA: ${question}

${ragBlock ? '--- DATOS REALES DE PROPVALUER (usa estos datos en el análisis) ---\n' + ragBlock + '\n--- FIN DATOS REALES ---\n\n' : ''}
MERCADO DE COMPRADORES (${allAgents.filter(a=>a.type==='buyer').length} potenciales):
- ${buyingCount} listos para comprar
- ${consideringCount} evaluando opciones  
- ${notBuyingCount} decidieron no comprar

AGENTES PARTICIPANTES EN DEBATE (${debateAgents.length}):
${debateAgents.map((a, i) => `${i+1}. ${a.name} (${a.role}) — ${a.style}`).join('\n')}

Genera ${totalRounds} rondas. En cada ronda participan 3-5 agentes con posturas contrastantes.
Los inversionistas debaten ROI y estructura financiera.
Los compradores potenciales expresan objeciones, dudas y motivaciones reales.
Los expertos analizan datos duros.

IMPORTANTE: Haz que los compradores que NO van a comprar expresen sus razones concretas.
Los que SÍ compran expresen su entusiasmo y preguntas finales.
Los que están considerando muestren sus dudas y qué los frenaría o convencería.

JSON exacto:
{
  "rounds": [
    {
      "round": 1,
      "activities": [
        {"agent_name": "...", "action": "post|analysis|reply|repost", "content": "texto específico con datos"}
      ]
    }
  ]
}`

  try {
    const raw = await callLLM([{ role: 'user', content: prompt }], { temperature: 0.85, max_tokens: 5000 })
    const parsed = parseJSON(raw)
    const agentByName = new Map(allAgents.map(a => [a.name, a]))

    for (const round of (parsed.rounds || [])) {
      sendEvent('status', {
        phase: 'simulating',
        message: `Ronda ${round.round} de ${totalRounds} — debate entre agentes...`,
        round: round.round, totalRounds,
      })

      for (const act of (round.activities || [])) {
        const agent = agentByName.get(act.agent_name) || debateAgents[0]
        const activity = {
          agent: agent.name, role: agent.role, emoji: agent.emoji, color: agent.color,
          action: act.action || 'post', content: act.content, round: round.round,
          agentData: agent,
        }
        activities.push(activity)
        sendEvent('agent_activity', activity)
        await sleep(500 + Math.random() * 300)
      }
      await sleep(400)
    }
  } catch (err) {
    console.warn('[Simulate] Debate generation failed:', err.message)
    // Fallback
    for (let r = 1; r <= totalRounds; r++) {
      sendEvent('status', { phase: 'simulating', message: `Ronda ${r}...`, round: r, totalRounds })
      const roundAgents = debateAgents.slice(0, 3)
      for (const agent of roundAgents) {
        const act = {
          agent: agent.name, role: agent.role, emoji: agent.emoji, color: agent.color,
          action: 'analysis', content: `Analizando ${project.name || 'el proyecto'} desde perspectiva de ${agent.role}...`,
          round: r, agentData: agent,
        }
        activities.push(act)
        sendEvent('agent_activity', act)
        await sleep(400)
      }
    }
  }

  return activities
}

/** Generate structured report */
async function generateReport(project, question, activities, allAgents, ragContext = {}) {
  const activitySummary = activities
    .filter(a => a.action !== 'join' && a.action !== 'like')
    .map(a => `[${a.role}] ${a.content}`)
    .join('\n')

  const buyerStats = {
    total: allAgents.filter(a => a.type === 'buyer').length,
    buying: allAgents.filter(a => a.type === 'buyer' && a.intent === 'buying').length,
    considering: allAgents.filter(a => a.type === 'buyer' && a.intent === 'considering').length,
    notBuying: allAgents.filter(a => a.type === 'buyer' && a.intent === 'notbuying').length,
  }

  const ragSummary = [ragContext.market, ragContext.financial].filter(Boolean).join('\n')

  const prompt = `Analista inmobiliario senior. Genera un reporte ejecutivo basado en la simulación de ${allAgents.length} agentes.

PROYECTO: ${project.name || 'Proyecto'} | ${project.location || 'México'} | ${project.type || 'residencial'}
${project.units ? `Unidades: ${project.units}` : ''} ${project.priceRange ? `| Precio: ${project.priceRange}` : ''}
PREGUNTA: ${question}

${ragSummary ? '--- DATOS REALES DE PROPVALUER ---\n' + ragSummary + '\n--- FIN DATOS REALES ---\n\n' : ''}
DEMANDA SIMULADA (${buyerStats.total} compradores potenciales):
- ${buyerStats.buying} compradores listos (${Math.round(buyerStats.buying/buyerStats.total*100)}% de absorción)
- ${buyerStats.considering} evaluando (${Math.round(buyerStats.considering/buyerStats.total*100)}%)
- ${buyerStats.notBuying} no comprarán (${Math.round(buyerStats.notBuying/buyerStats.total*100)}%)

DEBATE DE AGENTES:
${activitySummary.slice(0, 4000)}

Genera reporte SOLO en JSON:
{
  "badge": "Análisis de Viabilidad",
  "engine": "Nexus OASIS Simulation v2",
  "kpis": [
    {"label": "Absorción Proyectada", "value": "${buyerStats.buying} de ${buyerStats.total} unidades", "type": "positive"},
    {"label": "Tasa de Cierre", "value": "${Math.round(buyerStats.buying/buyerStats.total*100)}%", "type": "positive"},
    {"label": "nombre KPI", "value": "valor específico MXN/% real", "type": "positive|negative|neutral"}
  ],
  "sections": [
    {"title": "Análisis de Demanda", "items": ["punto 1 con datos", "punto 2", "punto 3"]},
    {"title": "Perfil del Comprador", "items": ["demografía", "motivaciones", "objeciones"]},
    {"title": "Análisis Financiero", "items": ["TIR", "VAN", "ROE"]},
    {"title": "Riesgos Identificados", "items": ["riesgo 1", "riesgo 2"]},
    {"title": "Conclusión", "text": "párrafo ejecutivo con recomendación clara"}
  ]
}

Genera 6-8 KPIs con valores REALES y específicos (números, porcentajes, MXN).
Todo en español. Basa el análisis en lo que dijeron los agentes.`

  const raw = await callLLM([{ role: 'user', content: prompt }], { temperature: 0.5, max_tokens: 3000 })
  return parseJSON(raw)
}

export function registerSimulationRoutes(app) {

  app.post('/api/simulate', async (req, res) => {
    const { project = {}, question = '' } = req.body
    if (!question.trim()) return res.status(400).json({ success: false, error: 'question is required' })

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const sendEvent = (event, data) => {
      try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) } catch (_) {}
    }

    const simId = `sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    try {
      sendEvent('status', { phase: 'initializing', message: 'Inicializando simulación Nexus...', simulationId: simId })

      // Phase 0.5: Fetch RAG context from Supabase
      sendEvent('status', { phase: 'fetching_data', message: 'Consultando datos reales de PropValuer...' })
      let ragContext = { market: null, financial: null, legal: null, buyer: null }
      try {
        ragContext = await getAllAgentContext(project)
        const ragSources = Object.entries(ragContext).filter(([, v]) => v).map(([k]) => k)
        if (ragSources.length) {
          sendEvent('status', { phase: 'data_loaded', message: `Datos reales cargados: ${ragSources.join(', ')}` })
        }
      } catch (e) {
        console.warn('[Simulate] RAG context fetch error:', e.message)
      }

      // Phase 1: Generate dynamic agents
      sendEvent('status', { phase: 'creating_agents', message: 'Generando ecosistema de agentes con IA...' })
      let dynamicAgents = { investors: [], buyers: [] }
      try {
        dynamicAgents = await generateDynamicAgents(project, question, project.units)
      } catch (e) {
        console.warn('[Simulate] Dynamic agent gen error:', e.message)
      }

      const allAgents = [
        ...EXPERT_AGENTS,
        ...dynamicAgents.investors,
        ...dynamicAgents.buyers,
      ]

      // Send full agent list to frontend for graph
      sendEvent('agents', {
        agents: allAgents,
        stats: {
          total: allAgents.length,
          experts: EXPERT_AGENTS.length,
          investors: dynamicAgents.investors.length,
          buyers: dynamicAgents.buyers.length,
          buyingIntent: dynamicAgents.buyers.filter(b => b.intent === 'buying').length,
          consideringIntent: dynamicAgents.buyers.filter(b => b.intent === 'considering').length,
          notBuyingIntent: dynamicAgents.buyers.filter(b => b.intent === 'notbuying').length,
        }
      })

      await sleep(500)

      // Phase 2: Agent debate (with RAG context injected)
      const activities = await generateAgentActivities(allAgents, project, question, sendEvent, ragContext)

      // Phase 3: Report
      sendEvent('status', { phase: 'generating_report', message: 'Generando reporte ejecutivo...' })
      let report
      try {
        report = await generateReport(project, question, activities, allAgents, ragContext)
      } catch (err) {
        console.error('[Simulate] Report generation failed:', err.message)
        report = {
          badge: 'Reporte de Simulación',
          engine: 'Nexus OASIS',
          kpis: [
            { label: 'Agentes', value: `${allAgents.length} participantes`, type: 'positive' },
            { label: 'Compradores', value: dynamicAgents.buyers.length.toString(), type: 'positive' },
          ],
          sections: [
            { title: 'Resumen', items: activities.filter(a => a.action !== 'join').slice(0, 5).map(a => `${a.role}: ${a.content}`) },
            { title: 'Conclusión', text: 'Simulación completada. Revisa el debate para más detalles.' },
          ],
        }
      }

      const sim = {
        id: simId, project, question,
        timestamp: new Date().toISOString(),
        status: 'completed',
        activitiesCount: activities.length,
        report,
        agentStats: {
          total: allAgents.length,
          experts: EXPERT_AGENTS.length,
          investors: dynamicAgents.investors.length,
          buyers: dynamicAgents.buyers.length,
        },
        allAgents,
      }
      saveSimulation(sim)

      sendEvent('report', { ...report, _simId: simId })
      sendEvent('done', { simulationId: simId })
    } catch (err) {
      console.error('[Simulate] Fatal error:', err)
      sendEvent('error', { message: err.message || 'Simulation failed' })
    } finally {
      res.end()
    }
  })

  app.get('/api/simulations', (req, res) => {
    const sims = listSimulations().map(s => ({
      id: s.id, project: s.project, question: s.question,
      timestamp: s.timestamp, status: s.status,
      kpis: s.report?.kpis?.slice(0, 3) || [],
      agentStats: s.agentStats,
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

  app.post('/api/scenarios/compare', async (req, res) => {
    const { simulationIds } = req.body
    if (!simulationIds || !Array.isArray(simulationIds) || simulationIds.length < 2) {
      return res.status(400).json({ success: false, error: 'At least 2 simulation IDs required' })
    }
    const sims = simulationIds.map(id => getSimulation(id)).filter(Boolean)
    if (sims.length < 2) return res.status(404).json({ success: false, error: 'Could not find enough simulations' })

    const kpiMatrix = {}
    sims.forEach(sim => {
      (sim.report?.kpis || []).forEach(kpi => {
        if (!kpiMatrix[kpi.label]) kpiMatrix[kpi.label] = []
        kpiMatrix[kpi.label].push({ simId: sim.id, project: sim.project?.name, value: kpi.value, type: kpi.type })
      })
    })

    let aiSummary = null
    try {
      const prompt = `Compara estos proyectos inmobiliarios y da una recomendación clara en español:\n\n${sims.map((s, i) => {
        const kpis = (s.report?.kpis || []).map(k => `  ${k.label}: ${k.value}`).join('\n')
        return `Proyecto ${i + 1}: ${s.project?.name || 'Sin nombre'}\n${kpis}`
      }).join('\n\n')}\n\nDa: 1) Hallazgos clave 2) Fortalezas/debilidades 3) Recomendación final`
      aiSummary = await callLLM([{ role: 'user', content: prompt }], { max_tokens: 1500 })
    } catch (e) { console.warn('[Compare] LLM failed:', e.message) }

    res.json({
      success: true,
      data: {
        simulations: sims.map(s => ({
          id: s.id, project: s.project, timestamp: s.timestamp,
          kpis: s.report?.kpis || [], agentStats: s.agentStats,
        })),
        kpiMatrix, aiSummary,
      },
    })
  })
}
