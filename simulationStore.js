/**
 * simulationStore.js — JSON file-backed simulation history
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'data')
const STORE_PATH = path.join(DATA_DIR, 'simulations.json')

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function readStore() {
  ensureDir()
  if (!fs.existsSync(STORE_PATH)) return []
  try { return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8')) }
  catch { return [] }
}

function writeStore(data) {
  ensureDir()
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2))
}

export function listSimulations() {
  return readStore().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
}

export function getSimulation(id) {
  return readStore().find(s => s.id === id) || null
}

export function saveSimulation(sim) {
  const store = readStore()
  const idx = store.findIndex(s => s.id === sim.id)
  if (idx >= 0) store[idx] = sim
  else store.push(sim)
  writeStore(store)
  return sim
}

export function deleteSimulation(id) {
  const store = readStore()
  const filtered = store.filter(s => s.id !== id)
  if (filtered.length === store.length) return false
  writeStore(filtered)
  return true
}
