/**
 * supabase-rag.js — RAG module connecting Nexus to PropValuer's Supabase
 * 
 * Provides context-aware queries for each agent type:
 *   - mercado: active_listings, market_intelligence, market_reports
 *   - financiero: appraisals, market_reports (financial KPIs)
 *   - legal/urbanista: knowledge_base_documents (leyes, PDUs, normas)
 *   - comprador: active_listings (comparables), appraisals (valuations)
 *   - inversionista: appraisals + market_intelligence + listings
 * 
 * Uses @supabase/supabase-js with service_role key for full read access.
 */

import { createClient } from '@supabase/supabase-js'

let supabase = null

function getClient() {
  if (supabase) return supabase
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
  if (!url || !key) {
    console.warn('[RAG] Supabase not configured — SUPABASE_URL or key missing')
    return null
  }
  supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  console.log('[RAG] Supabase client initialized:', url)
  return supabase
}

// ── Helper: safe query with error handling ──
async function safeQuery(fn) {
  const client = getClient()
  if (!client) return []
  try {
    const result = await fn(client)
    if (result.error) {
      console.warn('[RAG] Query error:', result.error.message)
      return []
    }
    return result.data || []
  } catch (err) {
    console.warn('[RAG] Query exception:', err.message)
    return []
  }
}

// ── Core query functions ──

/**
 * Get active listings filtered by location/type for market comparables
 */
export async function getListings({ state, municipality, colony, propertyType, operationType, limit = 20 } = {}) {
  return safeQuery(async (sb) => {
    let q = sb.from('active_listings')
      .select('id,title,property_type,operation_type,price,currency,price_per_sqm,area_total,area_built,bedrooms,bathrooms,parking,colony,municipality,state,url,listing_date')
      .eq('is_active', true)
      .order('listing_date', { ascending: false })
      .limit(limit)

    if (state) q = q.ilike('state', `%${state}%`)
    if (municipality) q = q.ilike('municipality', `%${municipality}%`)
    if (colony) q = q.ilike('colony', `%${colony}%`)
    if (propertyType) q = q.ilike('property_type', `%${propertyType}%`)
    if (operationType) q = q.ilike('operation_type', `%${operationType}%`)
    return q
  })
}

/**
 * Get knowledge base documents by type/scope for legal/regulatory context
 */
export async function getKnowledgeDocs({ documentType, scope, state, municipality, searchText, limit = 10 } = {}) {
  return safeQuery(async (sb) => {
    let q = sb.from('knowledge_base_documents')
      .select('id,title,description,document_type,scope,state,municipality,summary,key_topics,source_url,issuing_authority,publication_date,effective_date')
      .eq('is_active', true)
      .order('effective_date', { ascending: false, nullsFirst: false })
      .limit(limit)

    if (documentType) q = q.eq('document_type', documentType)
    if (scope) q = q.eq('scope', scope)
    if (state) q = q.ilike('state', `%${state}%`)
    if (municipality) q = q.ilike('municipality', `%${municipality}%`)
    if (searchText) q = q.textSearch('search_vector', searchText, { type: 'websearch' })
    return q
  })
}

/**
 * Get market intelligence reports
 */
export async function getMarketIntelligence({ limit = 5 } = {}) {
  return safeQuery(async (sb) => {
    return sb.from('market_intelligence')
      .select('*')
      .order('analysis_date', { ascending: false })
      .limit(limit)
  })
}

/**
 * Get recent appraisals for valuation context
 */
export async function getAppraisals({ state, municipality, propertyType, limit = 10 } = {}) {
  return safeQuery(async (sb) => {
    let q = sb.from('appraisals')
      .select('id,property_type,property_subtype,total_area,built_area,bedrooms,bathrooms,parking_spaces,property_age,conservation_state,final_value,value_per_sqm,confidence_score,grade_score,created_at')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (propertyType) q = q.ilike('property_type', `%${propertyType}%`)
    return q
  })
}

/**
 * Get market reports for zone analysis
 */
export async function getMarketReports({ zoneName, limit = 5 } = {}) {
  return safeQuery(async (sb) => {
    let q = sb.from('market_reports')
      .select('id,zone_name,zone_address,zone_type,tier,status,progress,quality_score,created_at')
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (zoneName) q = q.ilike('zone_name', `%${zoneName}%`)
    return q
  })
}

// ── Agent-specific context builders ──

/**
 * Extract location hints from project data
 */
function parseLocation(project) {
  const loc = (project.location || '').toLowerCase()
  // Try to extract state/municipality from location string
  const mexicanStates = ['cdmx', 'ciudad de méxico', 'jalisco', 'nuevo león', 'monterrey', 'guadalajara', 'puebla', 'querétaro', 'estado de méxico', 'yucatán', 'mérida', 'quintana roo', 'cancún']
  const state = mexicanStates.find(s => loc.includes(s)) || null
  return { state, municipality: null, raw: project.location }
}

/**
 * Build RAG context for market analyst agent
 */
export async function getMarketContext(project) {
  const loc = parseLocation(project)
  const [listings, intelligence] = await Promise.all([
    getListings({ state: loc.state, propertyType: project.type, limit: 15 }),
    getMarketIntelligence({ limit: 3 }),
  ])

  if (!listings.length && !intelligence.length) return null

  let context = '## DATOS REALES DE MERCADO (Supabase PropValuer)\n\n'

  if (listings.length) {
    const avgPrice = listings.reduce((s, l) => s + (l.price || 0), 0) / listings.length
    const avgPsm = listings.filter(l => l.price_per_sqm).reduce((s, l) => s + l.price_per_sqm, 0) / (listings.filter(l => l.price_per_sqm).length || 1)
    const types = [...new Set(listings.map(l => l.property_type).filter(Boolean))]
    const zones = [...new Set(listings.map(l => l.colony || l.municipality).filter(Boolean))].slice(0, 10)

    context += `### Comparables activos (${listings.length} propiedades)\n`
    context += `- Precio promedio: $${Math.round(avgPrice).toLocaleString()} MXN\n`
    context += `- Precio/m² promedio: $${Math.round(avgPsm).toLocaleString()} MXN\n`
    context += `- Tipos: ${types.join(', ')}\n`
    context += `- Zonas: ${zones.join(', ')}\n`
    context += `- Rango: $${Math.round(Math.min(...listings.map(l => l.price || 0))).toLocaleString()} - $${Math.round(Math.max(...listings.map(l => l.price || 0))).toLocaleString()} MXN\n\n`

    context += `Muestra de listings:\n`
    listings.slice(0, 8).forEach(l => {
      context += `  - ${l.title?.slice(0, 80)} | ${l.property_type} | $${(l.price || 0).toLocaleString()} ${l.currency || 'MXN'} | ${l.area_total || '?'}m² | ${l.colony || l.municipality || '?'}\n`
    })
    context += '\n'
  }

  if (intelligence.length) {
    context += `### Inteligencia de mercado\n`
    intelligence.forEach(i => {
      context += `- Sentimiento: ${i.market_sentiment || 'N/A'}\n`
      if (i.key_trends) context += `- Tendencias: ${JSON.stringify(i.key_trends).slice(0, 300)}\n`
      if (i.opportunities) context += `- Oportunidades: ${JSON.stringify(i.opportunities).slice(0, 300)}\n`
      if (i.risks) context += `- Riesgos: ${JSON.stringify(i.risks).slice(0, 200)}\n`
    })
  }

  return context
}

/**
 * Build RAG context for financial/investor agent
 */
export async function getFinancialContext(project) {
  const loc = parseLocation(project)
  const [appraisals, listings, reports] = await Promise.all([
    getAppraisals({ propertyType: project.type, limit: 10 }),
    getListings({ state: loc.state, propertyType: project.type, limit: 10 }),
    getMarketReports({ limit: 3 }),
  ])

  if (!appraisals.length && !listings.length) return null

  let context = '## DATOS FINANCIEROS REALES (Supabase PropValuer)\n\n'

  if (appraisals.length) {
    const avgValue = appraisals.reduce((s, a) => s + (a.final_value || 0), 0) / appraisals.length
    const avgVpsm = appraisals.filter(a => a.value_per_sqm).reduce((s, a) => s + a.value_per_sqm, 0) / (appraisals.filter(a => a.value_per_sqm).length || 1)
    const avgConfidence = appraisals.reduce((s, a) => s + (a.confidence_score || 0), 0) / appraisals.length

    context += `### Avalúos recientes (${appraisals.length})\n`
    context += `- Valor promedio: $${Math.round(avgValue).toLocaleString()} MXN\n`
    context += `- Valor/m² promedio: $${Math.round(avgVpsm).toLocaleString()} MXN\n`
    context += `- Confianza promedio: ${(avgConfidence * 100).toFixed(1)}%\n\n`

    appraisals.slice(0, 5).forEach(a => {
      context += `  - ${a.property_type} ${a.property_subtype || ''} | ${a.total_area || '?'}m² | Valor: $${(a.final_value || 0).toLocaleString()} | ${a.value_per_sqm ? '$' + Math.round(a.value_per_sqm).toLocaleString() + '/m²' : ''} | Confianza: ${((a.confidence_score || 0) * 100).toFixed(0)}%\n`
    })
    context += '\n'
  }

  if (listings.length) {
    const prices = listings.map(l => l.price).filter(Boolean)
    context += `### Precios de mercado (${listings.length} listings)\n`
    context += `- Mínimo: $${Math.round(Math.min(...prices)).toLocaleString()} MXN\n`
    context += `- Máximo: $${Math.round(Math.max(...prices)).toLocaleString()} MXN\n`
    context += `- Mediana: $${Math.round(prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)]).toLocaleString()} MXN\n\n`
  }

  if (reports.length) {
    context += `### Reportes de zona\n`
    reports.forEach(r => {
      context += `  - ${r.zone_name} (${r.zone_type || 'general'}) | Calidad: ${r.quality_score || 'N/A'} | Tier: ${r.tier || 'N/A'}\n`
    })
  }

  return context
}

/**
 * Build RAG context for legal/urbanist agent
 */
export async function getLegalContext(project) {
  const loc = parseLocation(project)
  const searchTerms = [project.type, project.location, 'inmobiliario'].filter(Boolean).join(' ')

  const [laws, pdus, norms] = await Promise.all([
    getKnowledgeDocs({ documentType: 'ley', state: loc.state, limit: 5 }),
    getKnowledgeDocs({ documentType: 'pdu', state: loc.state, limit: 5 }),
    getKnowledgeDocs({ searchText: searchTerms, limit: 8 }),
  ])

  const allDocs = [...laws, ...pdus, ...norms]
  // Deduplicate by id
  const seen = new Set()
  const unique = allDocs.filter(d => { if (seen.has(d.id)) return false; seen.add(d.id); return true })

  if (!unique.length) return null

  let context = '## MARCO LEGAL Y NORMATIVO (Knowledge Base PropValuer)\n\n'
  context += `### Documentos relevantes (${unique.length})\n`

  unique.forEach(d => {
    context += `- **${d.title?.slice(0, 100)}**\n`
    context += `  Tipo: ${d.document_type} | Alcance: ${d.scope || 'N/A'} | Autoridad: ${d.issuing_authority || 'N/A'}\n`
    if (d.summary) context += `  Resumen: ${d.summary.slice(0, 200)}\n`
    if (d.key_topics?.length) context += `  Temas: ${d.key_topics.join(', ')}\n`
    context += '\n'
  })

  return context
}

/**
 * Build RAG context for buyer agent
 */
export async function getBuyerContext(project) {
  const loc = parseLocation(project)
  const [listings, appraisals] = await Promise.all([
    getListings({ state: loc.state, propertyType: project.type, operationType: 'venta', limit: 15 }),
    getAppraisals({ propertyType: project.type, limit: 5 }),
  ])

  if (!listings.length) return null

  let context = '## OPCIONES DE MERCADO PARA COMPRADORES (Supabase PropValuer)\n\n'

  const priceRanges = { bajo: 0, medio: 0, alto: 0 }
  listings.forEach(l => {
    if (l.price < 2000000) priceRanges.bajo++
    else if (l.price < 5000000) priceRanges.medio++
    else priceRanges.alto++
  })

  context += `### Oferta disponible (${listings.length} propiedades en venta)\n`
  context += `- Segmento bajo (<$2M): ${priceRanges.bajo} propiedades\n`
  context += `- Segmento medio ($2M-$5M): ${priceRanges.medio} propiedades\n`
  context += `- Segmento alto (>$5M): ${priceRanges.alto} propiedades\n\n`

  context += `Opciones destacadas:\n`
  listings.slice(0, 10).forEach(l => {
    context += `  - ${l.title?.slice(0, 60)} | $${(l.price || 0).toLocaleString()} | ${l.bedrooms || '?'} rec | ${l.area_total || '?'}m² | ${l.colony || l.municipality || '?'}\n`
  })

  if (appraisals.length) {
    const avgVal = appraisals.reduce((s, a) => s + (a.final_value || 0), 0) / appraisals.length
    context += `\n### Referencia de avalúos\n`
    context += `- Valor promedio avaluado: $${Math.round(avgVal).toLocaleString()} MXN\n`
    context += `- Esto indica si los precios de lista están por encima o debajo del valor real\n`
  }

  return context
}

/**
 * Master function: get all RAG context for a simulation
 * Returns a map of agentType → context string
 */
export async function getAllAgentContext(project) {
  const [market, financial, legal, buyer] = await Promise.all([
    getMarketContext(project),
    getFinancialContext(project),
    getLegalContext(project),
    getBuyerContext(project),
  ])

  return {
    market,     // for: Analista de Mercado, Broker
    financial,  // for: Inversionista, Periodista Financiero
    legal,      // for: Urbanista, (any legal questions)
    buyer,      // for: Compradores potenciales
  }
}

// ── Knowledge Base CRUD for Nexus UI ──

/**
 * List knowledge base documents with pagination
 */
export async function listKnowledgeDocs({ page = 1, pageSize = 20, documentType, scope, search } = {}) {
  const client = getClient()
  if (!client) return { data: [], count: 0 }

  let q = client.from('knowledge_base_documents')
    .select('id,title,description,document_type,scope,state,municipality,issuing_authority,publication_date,effective_date,file_url,file_name,verification_status,created_at', { count: 'exact' })
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1)

  if (documentType) q = q.eq('document_type', documentType)
  if (scope) q = q.eq('scope', scope)
  if (search) q = q.textSearch('search_vector', search, { type: 'websearch' })

  const { data, error, count } = await q
  if (error) {
    console.warn('[RAG] listKnowledgeDocs error:', error.message)
    return { data: [], count: 0 }
  }
  return { data: data || [], count: count || 0 }
}

/**
 * Upload a document to knowledge base
 */
export async function uploadKnowledgeDoc({ title, description, documentType, scope, state, municipality, fileBuffer, fileName, contentType, sourceUrl }) {
  const client = getClient()
  if (!client) throw new Error('Supabase not configured')

  let fileUrl = null

  // Upload file to storage if provided
  if (fileBuffer && fileName) {
    const storagePath = `nexus-uploads/${Date.now()}_${fileName}`
    const { data: uploadData, error: uploadError } = await client.storage
      .from('knowledge-base-documents')
      .upload(storagePath, fileBuffer, { contentType: contentType || 'application/pdf', upsert: false })

    if (uploadError) throw new Error(`File upload failed: ${uploadError.message}`)

    const { data: urlData } = client.storage
      .from('knowledge-base-documents')
      .getPublicUrl(storagePath)
    fileUrl = urlData?.publicUrl
  }

  // Insert document record
  const { data, error } = await client.from('knowledge_base_documents').insert({
    title,
    description: description || `Documento subido desde Nexus`,
    document_type: documentType || 'otro',
    scope: scope || 'federal',
    state: state || null,
    municipality: municipality || null,
    source_url: sourceUrl || null,
    file_url: fileUrl,
    file_name: fileName || null,
    is_active: true,
    country: 'MX',
    version: '1.0',
    verification_status: 'pending',
    extracted_text: `${title} ${description || ''} ${documentType || ''}`,
    summary: description || title,
  }).select().single()

  if (error) throw new Error(`Insert failed: ${error.message}`)
  return data
}

/**
 * Get document types for the upload form
 */
export async function getDocumentTypes() {
  return safeQuery(async (sb) => {
    return sb.from('knowledge_base_document_types')
      .select('code,name_es,description,typical_scope,icon')
      .eq('is_active', true)
      .order('display_order')
  })
}

/**
 * Get a single document with full text
 */
export async function getKnowledgeDoc(id) {
  const client = getClient()
  if (!client) return null
  const { data, error } = await client.from('knowledge_base_documents')
    .select('*')
    .eq('id', id)
    .single()
  if (error) return null
  // Strip embedding from response (huge)
  if (data) delete data.embedding
  return data
}

/**
 * Delete (soft) a knowledge base document
 */
export async function deleteKnowledgeDoc(id) {
  const client = getClient()
  if (!client) return false
  const { error } = await client.from('knowledge_base_documents')
    .update({ is_active: false })
    .eq('id', id)
  return !error
}

// ── Stats ──

export async function getRAGStats() {
  const client = getClient()
  if (!client) return { connected: false }

  const [listings, docs, appraisals] = await Promise.all([
    client.from('active_listings').select('id', { count: 'exact', head: true }).eq('is_active', true),
    client.from('knowledge_base_documents').select('id', { count: 'exact', head: true }).eq('is_active', true),
    client.from('appraisals').select('id', { count: 'exact', head: true }),
  ])

  return {
    connected: true,
    listings: listings.count || 0,
    knowledgeDocs: docs.count || 0,
    appraisals: appraisals.count || 0,
  }
}
