import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '.env.local') })
console.log('LLM_API_KEY:', process.env.LLM_API_KEY ? `SET ✅ (${process.env.LLM_API_KEY.slice(0,15)}...)` : 'EMPTY ❌')
console.log('ZEP_API_KEY:', process.env.ZEP_API_KEY ? `SET ✅ (${process.env.ZEP_API_KEY.slice(0,15)}...)` : 'EMPTY ❌')
