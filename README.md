# ProjectPulse

Turn scattered project knowledge into institutional memory: upload documents, extract a knowledge graph, generate a reviewable handover packet, ask questions with source references, and evaluate who is ready to take over — with permissions enforced server-side at every step.

## Stack

**Backend** — FastAPI · SQLAlchemy 2 · Alembic · PostgreSQL 17 + pgvector · Argon2id password hashing · opaque session-cookie auth.

**Frontend** — Vite · React 19 · TypeScript · Tailwind v4 (design tokens in `src/index.css`) · TanStack Query · React Router · Radix UI + sonner · lucide-react · @xyflow/react (knowledge graph) · GSAP + Lenis (landing page only).

**Quality gates** — pytest (backend, 10 tests), Playwright (landing e2e 30/30 + fixes 11/11), `npm run lint`, `npm run build`.

## Prerequisites

- PostgreSQL 17 with the `pgvector` extension available
- Python 3.12+ and Node.js 20+

## Quick start

```powershell
# 1. Database (once)
$env:PGPASSWORD='projectpulse_dev_pw'
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U projectpulse -h 127.0.0.1 -w -c "CREATE DATABASE projectpulse;"
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U projectpulse -h 127.0.0.1 -w -d projectpulse -c "CREATE EXTENSION vector;"

# 2. Backend config (once)
Copy-Item .env.example .env      # then fill in SESSION_SECRET

# 3. Backend deps + migrations
cd backend
python -m venv .venv
\.\\venv\\Scripts\\python.exe -m pip install -r requirements.txt
\.\\venv\\Scripts\\alembic.exe upgrade head

# 4. Run API  (http://127.0.0.1:8000, docs at /docs, health at /api/health)
\.\\venv\\Scripts\\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# 5. Run frontend  (http://localhost:5199, proxies /api -> :8000)
npm install
npm run dev
```

## Demo data

Click **“Load demo data”** in the sidebar (or `POST /api/demo/seed`). Seeds workspace *Northwind Delivery*, project *Payments Platform*, 7 documents, knowledge items, relationships, and a handover in `needs_review`.

| Account | Role | Password |
|---|---|---|
| `admin@projectpulse.dev` | Seeder / workspace owner | `Handover!2026` |
| `alex@northwind.dev` | Project head | `Handover!2026` |
| `sarah@northwind.dev` | Project lead (only member with the restricted incident doc) | `Handover!2026` |
| `daniel@northwind.dev` | Project member | `Handover!2026` |
| `maya@northwind.dev` | Successor (sees the handover only after it's shared) | `Handover!2026` |

Demo markdown source files live in `backend/demo_files/`.

## Tests

```powershell
# Backend (uses projectpulse_test database — DATABASE_URL is forced by tests/conftest.py)
cd backend
$env:DATABASE_URL='postgresql+psycopg://projectpulse:projectpulse_dev_pw@127.0.0.1:5432/projectpulse_test'
\\.\\venv\\Scripts\\python.exe -m pytest

# Frontend gates
npm run lint
npm run build
node scripts/test-e2e.mjs     # landing e2e — 30/30
node scripts/test-fixes.mjs   # landing regression — 11/11
```

## How it works

1. **Ingest** — Markdown/DOCX/PDF/CSV/TXT/HTML parsed → heading-aware chunked (deterministic byte-hash IDs) → embedded into pgvector → entities, decisions, risks, outcomes, and relationships extracted and stored with source references.
2. **Knowledge** — Browse/search extracted items, review pending extractions, explore the knowledge graph (`/app/graph`), all visibility-filtered by project membership.
3. **Handover** — Structured 7-section packet generated from project knowledge with findings, risks, and open decisions; lives in `needs_review` until a head/lead edits, shares, or approves it.
4. **Assistant** — Project chat answering strictly from your documents/knowledge (chunk IDs + clickable references), with follow-up suggestions.
5. **Authority** — Role-aware workspace/project model (`owner/lead/member/successor` × `head/lead/member/successor`), capability matrix, readiness indicators, audit trail of every privileged action.

## Project structure

```
backend/
  app/
    api/          auth, workspaces, projects, documents, processing, search,
                  knowledge, handover, assistant, authority, activity, demo, errors
    core/         config, security (argon2 + session tokens), deps
    db/           session, models (25 tables)
    schemas/      frozen contract schemas (frozen=True, extra="forbid")
    services/     permissions, audit, parsers, chunker, extraction, rag,
                  llm, embedding, handover_gen, assistant_svc, seed
  alembic/        migrations (086263a84da9 init, 8fed1142255c document_grants)
  demo_files/     demo markdown corpus
  tests/          pytest smoke suite
src/
  pages/          landing + auth + app (Overview, Documents, Knowledge, Graph,
                  Handover, Assistant, Authority, Activity, Settings)
  components/     landing sections, app shell, ui primitives
  styles/         app.css, pages-data.css, pages-handover.css
  lib/            api client, types, markdownLite
scripts/          Playwright landing tests
```

## API surface

47 documented paths under `/api` — OpenAPI at `http://127.0.0.1:8000/docs`. Health: `GET /api/health` returns readiness, database, and vector status.

## Known limitations

- **Handover generation is synchronous**; no streaming/progress websocket yet.
- **Malformed extraction output during handover generation** can return an error instead of always falling back to the deterministic generator (retry logic covers most cases).
- **`generation_meta`** (model, latency, token counts) is captured internally but not yet exposed on the handover API response.
- **Seeding into a pre-existing workspace** reports `already: true` without back-filling documents if the workspace name collides — use *Reset demo data* first.
- **No Docker setup** — `docker-compose.yml` was intentionally omitted (no Dockerfiles shipped); the documented path is local PostgreSQL.
- Landing-page regression tests target `http://localhost:5199` (IPv6 loopback); the API proxy points at `127.0.0.1:8000`.

## Security notes

- `.env` is git-ignored — never commit API keys or session secrets.
- Passwords are Argon2id-hashed; session tokens are random values stored only as SHA-256 hashes.
- All multi-tenant queries are scoped by workspace/project membership, and document/knowledge visibility is enforced in SQL, not just in the UI.