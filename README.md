# 🔷 Nexus — AI-Powered Real Estate Investment Simulator

**Nexus** is an intelligent simulation platform for real estate investment analysis in Mexico. It combines market data, AI-driven projections, and interactive scenario modeling to help investors evaluate development opportunities before committing capital.

---

## Architecture / Arquitectura

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  Frontend (React)│────▶│  Backend (Express)│────▶│  MiroFish (Python)  │
│  Vercel          │     │  Railway          │     │  AI Engine           │
└─────────────────┘     └──────────────────┘     └─────────────────────┘
         │                        │
         │                        ├── /health
         │                        ├── /api/projects
         │                        └── /api/mirofish/*
         │
         └── React + Vite (SPA)
```

- **Frontend:** React + Vite → deployed on **Vercel**
- **Backend:** Express/Node.js → deployed on **Railway**
- **MiroFish:** Python AI engine (LLM-powered analysis) → managed by backend

---

## 🚀 Run Locally / Correr Localmente

### Prerequisites / Requisitos

- Node.js 18+
- Python 3.11+ (for MiroFish)
- npm

### Setup

```bash
# Clone and install
cd nexus
npm install

# Configure environment
cp .env.local .env
# Edit .env with your actual API keys

# Start development server
npm run dev
```

The server starts at `http://localhost:4001`.

### Verify it works / Verificar que funciona

```bash
# Health check
curl http://localhost:4001/health

# MiroFish status
curl http://localhost:4001/api/mirofish/status

# List projects
curl http://localhost:4001/api/projects
```

---

## 🔑 Environment Variables / Variables de Entorno

| Variable | Description | Required |
|---|---|---|
| `PORT` | Server port (default: 4001) | No |
| `LLM_API_KEY` | OpenAI API key for MiroFish | Yes |
| `ZEP_API_KEY` | Zep memory API key | Yes |
| `LLM_MODEL_NAME` | LLM model (default: gpt-4o-mini) | No |

---

## 🚂 Deploy to Railway / Desplegar en Railway

1. **Create a new project** on [Railway](https://railway.app)
2. **Connect your GitHub repo** or use Railway CLI
3. **Set environment variables** in Railway dashboard:
   - `PORT` → Railway sets this automatically
   - `LLM_API_KEY` → your OpenAI key
   - `ZEP_API_KEY` → your Zep key
   - `LLM_MODEL_NAME` → `gpt-4o-mini` (or preferred model)
4. **Deploy settings:**
   - Build command: `npm install`
   - Start command: `npm start`
   - Root directory: `/` (or wherever the backend lives)
5. Railway will auto-deploy on every push to `main`

### Railway CLI (optional)

```bash
npm i -g @railway/cli
railway login
railway init
railway up
```

---

## 📁 Project Structure / Estructura del Proyecto

```
nexus/
├── server.js              # Express server (main entry)
├── mirofish-manager.js    # MiroFish process manager & proxy
├── mirofish-backend/      # Python MiroFish AI engine
│   ├── app/               # FastAPI application
│   ├── locales/           # i18n translations
│   ├── scripts/           # Utility scripts
│   ├── run.py             # MiroFish entry point
│   ├── requirements.txt   # Python dependencies
│   └── pyproject.toml     # Python project config
├── .mirofish-venv/        # Python virtual environment
├── .env.local             # Environment template
├── package.json           # Node.js dependencies
└── README.md              # This file
```

---

## 🧪 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Service health check |
| `GET` | `/api/projects` | List all projects |
| `POST` | `/api/projects` | Create a new project |
| `GET` | `/api/projects/:id` | Get project by ID |
| `GET` | `/api/mirofish/status` | MiroFish engine status |
| `POST` | `/api/mirofish/start` | Start MiroFish engine |
| `POST` | `/api/mirofish/stop` | Stop MiroFish engine |
| `POST` | `/api/mirofish/chat` | Chat with MiroFish AI |

---

## License

Private — All rights reserved.
