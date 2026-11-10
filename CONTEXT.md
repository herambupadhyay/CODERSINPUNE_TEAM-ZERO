# CONTEXT.md — ProjectPulse full project context (session handoff)

> **For AI agents (Kilo Code, opencode, etc.).** This file is the complete handoff brief for the
> ProjectPulse repository. It was written by the opencode session that built and shipped this
> codebase. Read it fully before doing anything. It is auto-discovered by Kilo Code as a project
> instruction file.
>
> **Load-verification (do this first, reply only):** state (1) git HEAD short-hash, (2) remote URL,
> (3) both dev ports, (4) demo account password, (5) two of the known bugs listed in §10. Then stop
> and wait for instructions. **Do not edit files, run commands, or "fix" anything unless asked.**

---

## 1. What this project is

**ProjectPulse — AI Handover Assistant.** A full-stack hackathon-quality web app: upload project
documents → parse/chunk/embed them → LLM extracts a knowledge graph (entities, decisions, risks,
relationships) → generate a reviewable 7-section handover packet → citation-backed Q&A assistant →
role-aware "Authority" readiness views. Permissions are enforced **server-side at every step**.

It also has a **marketing landing page** (GSAP/Lenis scroll narrative) at `/`, with the actual app
under `/app` behind login.

- Frontend dev URL: **http://localhost:5199** (Vite; note it binds IPv6 `::1`, so `localhost` works
  but `127.0.0.1:5199` does NOT)
- Backend API: **http://127.0.0.1:8000** (FastAPI; interactive docs at `/docs`, health at
  `/api/health`; OpenAPI has **47 paths**)
- Vite proxies `/api` → `127.0.0.1:8000`

## 2. Tech stack

| Layer | Choice |
|---|---|
| Frontend | Vite 8 · React 19 · TypeScript · Tailwind v4 (`@theme` tokens in `src/index.css`) · TanStack Query · React Router 7 · Radix UI · sonner · lucide-react · @xyflow/react (graph) · GSAP + Lenis (landing only) |
| Backend | FastAPI · SQLAlchemy 2.0 (typed ORM) · Alembic · Pydantic v2 frozen schemas (`extra="forbid"`) · Argon2id passwords · opaque session tokens (DB-stored, SHA-256 hashed) |
| DB | PostgreSQL 17 + **pgvector 0.8.6** (2048-dim embeddings, HNSW/IVF-capable) |
| AI | NVIDIA NIM, OpenAI-compatible (`https://integrate.api.nvidia.com/v1`) — chat `nvidia/nemotron-3.5-lightning-30b-a3b`, fallback `deepseek-ai/deepseek-v4.1-flash`, embeddings `nvidia/nemotron-3-embed-1b` (2048 dims). Key lives in repo-root `.env` as `LLM_API_KEY` (never commit `.env`). Sample/demo mode kicks in when key empty or `DEMO_MODE=true`. |
| Tests | pytest (backend, 10 tests) · Playwright scripts (landing, 30/30 + 11/11) · oxlint · `tsc`+vite build |

## 3. Live environment (state at handoff)

- **API up**: `uvicorn app.main:app --host 127.0.0.1 --port 8000` run from `backend/`, with venv
  `backend\.venv` (Python 3.12.16). Logs: `backend/api.log`, `backend/api.err.log`.
  Health: `status=ok, database=ok, ai_configured=true`.
- **Vite up**: `npm run dev` from repo root → :5199 (log `vite.log`).
- **PostgreSQL 17** service `postgresql-x64-17`, role `projectpulse` / `projectpulse_dev_pw`,
  databases `projectpulse` (dev) and `projectpulse_test` (tests), extension `vector` enabled on both.
  psql: `"C:\Program Files\PostgreSQL\17\bin\psql.exe" -U projectpulse -h 127.0.0.1 -w`.
- **Migrations ALREADY APPLIED to both DBs** (revisions `086263a84da9` initial 24 tables + `8fed1142255c`
  document_grants = 25 tables). **DO NOT run `alembic upgrade head`** unless a genuinely new
  migration was authored — the DBs are already current.
- Python package installs: `python -m uv pip install --python .\.venv\Scripts\python.exe <pkg>`
  (pip shim is unreliable; uv is the working path).
- **Demo data seeded** in dev DB: workspace *Northwind Delivery*, project *Payments Platform*,
  counts `users=5 documents=7 chunks=29 knowledge=18 relationships=14 handovers=1 sections=7 findings=9`.
  Handover is in `needs_review`.

## 4. Repository & git state

- **Remote**: `https://github.com/herambupadhyay/CODERSINPUNE_TEAM-ZERO.git`, branch `main`.
- **HEAD**: `bff755cd7682d5d61515f6c71ba114a60d955e10` — worktree clean, in sync with origin.
- **4 commits** (the repo was pushed in staged slices; now complete, 136 tracked files):
  1. `b8f6b23` landing + core UI slice (+26.0% of lines)
  2. `f0f3f9e` app shell + Documents/Graph/Handover pages (+19.6%)
  3. `d871e15` remaining 5 pages + AI services + schemas + scripts (+30.0%)
  4. `bff755c` everything else: API routers, models, core, migrations, tests, demo corpus, README,
     package-lock, **and the landing CTA fix** (wired CTAs to real auth routes)
- **Untracked scratch (intentionally never committed)**: `backend/tmp_llmtest.py`,
  `backend/tmp_llmtest2.py` (one-off LLM probes).
- `.gitignore` covers: `.env`, `*.log`, `node_modules/`, `dist/`, `__pycache__/`, `.pytest_cache/`,
  `backend/.venv/`, `backend/storage/` (uploaded docs), `test-output/` (Playwright screenshots).
- **Verified after final push**: fresh clone == local (136/136 identical inventory; committed blobs
  bit-identical; raw file-hash diffs were CRLF-only checkout conversion); clone passed
  `npm ci` → `npm run build` → `npm run lint`; all 61 backend `.py` files `compileall` clean.

## 5. Architecture — backend

Request flow: cookie session (`pp_session`) → `core/deps.py` (`get_current_user`) →
`services/permissions.py` (`require_workspace` / `require_project`, `effective_project_role`,
`can_*`, visibility helpers) → routers in `app/api/*` → services → DB. Every privileged action is
written to `audit_events` via `services/audit.py`.

**Permission model (enforced in SQL, not just UI):**
- Workspace roles: `owner / lead / member / successor`. Project roles: `head / lead / member / successor`.
- Workspace **owner is the effective project head**. Project `head` gets all project powers.
- `ProjectRole.MEMBER` **CAN upload documents** but **CANNOT review/approve** (403) — this is by spec.
- Document visibility: `access_scope` = `project` (all members) or `restricted` (only rows in
  `document_grants`). Chunk/knowledge/search queries filter by the caller's visible IDs.
- Handovers: successors only see a handover after it is **shared**; approval requires head/lead.
- Errors: uniform envelope `{"error": code, "detail": human text}` from `app/api/errors.py`;
  `NotFoundError` / `PermissionError_` raised by the permissions layer.

**Data model (25 tables)** — `app/db/models/`:
- `identity.py`: users, sessions, workspaces, workspace_members, projects, project_members,
  invitations, audit_events
- `documents.py`: documents, document_chunks (pgvector `embedding`), document_grants
- `knowledge.py`: knowledge_items, knowledge_relationships
- `ai.py`: llm_extractions (raw model outputs w/ usage/latency), extraction_runs
- `handover.py`: handovers, handover_sections, handover_findings, conversations, messages
- `types.py`: UUID/GUID + pgvector column types; `domain/enums.py`: all enums.

**Ingestion pipeline:** `services/parsers.py` (md/txt/docx/pdf/csv/html — pymupdf for PDF, python-docx)
→ `chunker.py` (heading-aware, deterministic byte-hash chunk IDs) → `embedding.py` (NIM 2048-dim)
→ `extraction.py` (schema-validated LLM extraction of entities/decisions/risks/relationships;
`is_sample` flag when running without a key) → stored with source refs for citations.

**RAG / assistant:** `rag.py` (pgvector similarity + visibility filters) → `assistant_svc.py`
(project-scoped chat, answers strictly from visible documents/knowledge, returns chunk citations +
follow-up suggestions; system instruction forbids outside knowledge).

**Handover generation:** `handover_gen.py` — builds 7 sections + findings from project knowledge
with a structured-JSON LLM pass (chat_json with retry/fallback in `llm.py`), deterministic fallback
generator when the model fails. Runs **synchronously (1–5 min with real LLM)**. Known bug: §10.

**Other services:** `permissions.py` (capability matrix), `audit.py`, `seed.py` (demo seeder —
idempotent-ish; see §10 edge), `llm.py` (chat/chat_json, primary+fallback model retry).

**API routers** (`app/api/`, 47 paths): auth (signup/login/logout/me, argon2 + opaque session
cookies), workspaces, projects, documents (upload/list/detail/revoke), processing (status/reprocess),
search (vector+keyword), knowledge (list/detail/review/graph), handover (CRUD/generate/sections/
findings/share/approve), assistant (conversations/messages/suggestions), authority (me/matrix/
readiness/audit), activity, demo (seed/reset/status), errors + health in `main.py`.

**Schemas** (`app/schemas/`): frozen Pydantic contracts (`frozen=True`, `extra="forbid"`) mirroring
the MASTER spec — auth, workspace, project, document, knowledge (+`GraphOut`/`EdgeOut`/`GraphNode`),
handover, assistant, authority, common (page envelopes, error shape).

## 6. Architecture — frontend

- `src/main.tsx` → `AppProviders` (React Query + session provider) → `router.tsx`.
- Router: `/` → `App.tsx` (landing composition), `/login`, `/signup` (anonymous-only wrapper),
  `/app` → `AppShell` (sidebar + workspace/project switchers) with children:
  `index` Overview, `documents`, `knowledge`, `graph`, `authority`, `handover`, `assistant`,
  `activity`, `settings`; `*` → `/`.
- API client `lib/api.ts` (typed, cookie sessions, error envelope mapping) + `lib/types.ts` (mirror
  of backend schemas). `lib/markdownLite.ts` = safe minimal markdown renderer (handover/assistant).
- **Landing** (`App.tsx` + `components/{hero,problem,process,intelligence,handover,departure,trust,cta,footer,nav,cursor}` +
  `data/*` + `hooks/{useLenis,useMedia,useScroll}`): GSAP ScrollTrigger narrative, liquid cursor,
  section nav. **`components/ui/DemoModal.tsx` is now DEAD CODE** — the "prototype/early access"
  modal is no longer reachable (see §10 / CTA fix below).
- **CTA behavior (fixed in commit 4)**: navbar/mobile **Sign in → `/login`**; **Get Started**,
  hero **Explore ProjectPulse**, final **Start with ProjectPulse**, footer **Request early access →
  `/signup`**; **Revisit the demo** smooth-scrolls to `#product`. No modal anywhere.
- Design system: tokens in `src/index.css` (`@theme`); editorial palette — cream/ink/forest/ember
  accents; **NO blue/purple/neon**; fonts Fraunces (display) / Inter (body) / JetBrains Mono (labels).
  App styles: `styles/app.css`, `styles/pages-data.css` (docs/knowledge/graph), `styles/pages-handover.css`.
- Shared app primitives: `components/app/ui.tsx` (Button, Badge, Table, Modal, Spinner, StatCard…),
  `AppShell` (nav, workspace/project context, logout, demo reset).

## 7. Complete file inventory (136 tracked files)

**Root (11):** `index.html`, `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig.json`,
`tsconfig.app.json`, `tsconfig.node.json`, `.gitignore`, `.oxlintrc.json`, `README.md`, `.env.example`
(env template — safe; the real `.env` with the NVIDIA key is git-ignored).

**public/ (1):** `favicon.svg`.

**scripts/ (2):** `test-e2e.mjs` (30 landing checks — includes CTA-navigation assertions and an
expected-401 console filter), `test-fixes.mjs` (11 regression checks). Both target
`http://localhost:5199`.

**src/ (51):**
- entry/shell: `main.tsx`, `App.tsx`, `router.tsx`, `index.css`, `providers/AppProviders.tsx`
- app pages (9): `pages/app/{Overview,Documents,Knowledge,Graph,Authority,Handover,Assistant,Activity,Settings}Page.tsx`
- auth pages (2): `pages/auth/{Login,Signup}Page.tsx`
- app components: `components/app/{AppShell,ui}.tsx`
- landing components (14): `components/{nav/Navbar, hero/Hero, hero/HeroNetwork, problem/ProblemScatter,
  process/ProcessHorizontal, intelligence/{DualSystems,KnowledgeGraph,AuthorityLayer},
  handover/HandoverReport, departure/DepartureMap, trust/TrustSection, cta/FinalCta,
  footer/Footer, cursor/LiquidCursor}.tsx` + `components/ui/{DemoModal,MagneticButton,Reveal}.tsx`
- data (5): `data/{hero,intelligence,handover,departure,nav}.ts`
- hooks (3): `hooks/{useLenis,useMedia,useScroll}.*`
- lib (6): `lib/{api,types,queryClient,markdownLite,gsap}.*` (5 `.ts` + …) — `api.ts`, `types.ts`,
  `queryClient.ts`, `markdownLite.ts`, `gsap.ts` (GSAP plugin registration incl. SplitText/ScrollTrigger)
- styles (3): `styles/{app,pages-data,pages-handover}.css`

**backend/ (71):**
- root: `alembic.ini`, `pytest.ini`, `seed/__init__.py` (legacy stub)
- `alembic/` (5): `env.py`, `script.py.mako`, `versions/086263a84da9_initial_schema.py`,
  `versions/8fed1142255c_document_grants.py`
- `app/` (48): `main.py`, `domain/{__init__,enums}.py`, `core/{config,security,deps,__init__}.py`,
  `db/{base,session,types,__init__}.py` + `db/models/{identity,documents,knowledge,ai,handover,__init__}.py`,
  `api/` (15): `{auth,workspaces,projects,documents,processing,search,knowledge,handover,assistant,authority,activity,demo,errors,__init__}.py`,
  `schemas/` (11): `{auth,workspace,project,document,knowledge,handover,assistant,authority,common,__init__}.py`,
  `services/` (12): `{permissions,audit,llm,embedding,parsers,chunker,extraction,rag,handover_gen,assistant_svc,seed,__init__}.py`
- `tests/` (3): `conftest.py` (forces `projectpulse_test` DB before app import; fixtures client/
  owner/outsider/cleanup with correct purge ordering), `test_smoke.py` (10 tests), `__init__.py`
- `demo_files/` (7): `architecture-overview`, `payment-flow`, `auth-service-runbook`,
  `api-gateway-notes`, `incident-2026-03-15` (**restricted** — granted only to sarah),
  `offboarding-checklist`, `team-and-ownership` (all `.md`, fictional data)

## 8. Verification status (all green at handoff)

| Gate | Result | How to re-run |
|---|---|---|
| Backend tests | **10/10** (~5s) | `cd backend`; `$env:DATABASE_URL='postgresql+psycopg://projectpulse:projectpulse_dev_pw@127.0.0.1:5432/projectpulse_test'`; `.\.venv\Scripts\python.exe -m pytest` |
| Type build | ✓ | `npm run build` |
| Lint | ✓ exit 0 (pre-existing landing warnings only: `only-export-components` in AppProviders/ui/DemoModal) | `npm run lint` |
| Landing e2e | **30/30** | `node scripts/test-e2e.mjs` (needs :5199) |
| Landing regression | **11/11** | `node scripts/test-fixes.mjs` |
| CTA flows (temp smoke) | 7/7: Sign in→/login, 4 CTAs→/signup, Revisit stays + no modal | (was ad-hoc Playwright; covered by updated test-e2e step 10) |
| API live | health ok, 47 OpenAPI paths, graph/knowledge/handover/authority/documents/search all verified against seed | `Invoke-WebRequest http://127.0.0.1:8000/api/health` |
| Graph page | 18 nodes / 14 edges rendered, 0 page errors | — |
| Push integrity | clone==local, blobs bit-identical, clone builds, 61 py compile | — |

**Test gotchas:** test emails must end `@example.com` (email-validator rejects `.test`); pytest
teardown purges workspaces before users (plain FK, no ORM relationship — `db.flush()` required);
tests must import the app only after `conftest.py` sets `DATABASE_URL` (it does, via module top).

## 9. Demo accounts & data (dev DB)

All passwords: **`Handover!2026`**

| Email | Role |
|---|---|
| `admin@projectpulse.dev` | seeder / owner of the seeded workspace (created by `POST /api/demo/seed`) |
| `alex@northwind.dev` | project **head** |
| `sarah@northwind.dev` | project **lead** — the ONLY member who can read the restricted incident doc |
| `daniel@northwind.dev` | project **member** (can upload, cannot review) |
| `maya@northwind.dev` | **successor** (sees the handover only after it's shared) |

- Sidebar has **"Load demo data"** and **"Reset demo data"** (Settings page too) → `POST /api/demo/seed|reset`.
- Seeded handover: 7 sections, 9 findings, status `needs_review`.
- Extraction ran with a real NIM key → knowledge items carry `is_sample` tags where the model
  labelled sample outputs; `authority/me` as admin: `role=head, can.approve_handover=true`.

## 10. Known bugs & intentional omissions (BACKLOG — user said leave these unless asked)

1. **Handover generation is slow & can 400**: `services/handover_gen.py:589-618` — if the LLM returns
   malformed JSON after retries, the endpoint can return 400 instead of always falling back to the
   deterministic generator. Generation is synchronous (1–5 min); no streaming/progress socket.
2. **`generation_meta`** (model, latency, token counts) is captured internally but NOT exposed on
   `HandoverOut` (schema change would need contract update).
3. **Seed partial edge**: seeding into a pre-existing workspace with the same name can report
   `already: true` with 0 documents — fix path is Reset-then-Seed. (Dev DB was wiped before the
   current seed, so first-run is clean.)
4. **No Docker**: `docker-compose.yml` deliberately absent (no Dockerfiles; Docker blocked by WSL2
   not being set up on this machine). Documented path is local PostgreSQL.
5. **README.md and `backend/tests/conftest.py` contain the local dev DB password**
   (`projectpulse_dev_pw`) — user chose to push the whole code as-is. Rotate if the repo is public.
6. **`src/components/ui/DemoModal.tsx` is dead code** (CTA fix removed all callers; `DemoModalProvider`
   still wraps the landing in `App.tsx` but never opens). Safe to delete in a future cleanup —
   only with user approval, and then re-run both Playwright scripts.
7. Vite binds `::1` only — use `localhost:5199`, not `127.0.0.1:5199`.
8. Chunk-size build warning (>500kB) from vite — cosmetic, accepted.

## 11. Design & quality constraints (do not regress)

- **Landing tests must stay green**: after ANY change under `src/`, run `npm run build`,
  `npm run lint`, `node scripts/test-e2e.mjs`, `node scripts/test-fixes.mjs`.
- No blue/purple/neon; palette cream/ink/forest/ember; fonts Fraunces/Inter/JetBrains Mono; tokens
  only via `@theme` in `src/index.css`.
- **Every button must do something real** (no dead CTAs — that was the original sin, fixed in commit 4).
- Permission checks live in `services/permissions.py` — never trust UI-only gating; add a test when
  adding a route that crosses a permission boundary.
- Backend contract = frozen schemas; API responses validated by `response_model`.
- Don't run `alembic upgrade head` (already applied); don't commit `.env`; never log secrets.
- Windows/UAC: installs need user approval. File endings: repo has CRLF-normalized worktrees
  (autocrlf) — content is LF in git blobs.

## 12. Working etiquette for this (buddy) workflow

1. **Turn-taking**: never edit files while another agent's turn is in flight. Coordinate via git:
   commit → other agent reviews/diffs → next turn.
2. **Before claiming anything done**, run the gates in §8 that touch what you changed (minimum:
   `npm run build` + `npm run lint` for frontend; `pytest` for backend).
3. **Do not push to GitHub without explicit user instruction.** The user drives push decisions
   (history: pushed in % slices at their request).
4. AGENTS.md / CONTEXT.md are write-protected in Kilo — ask the user before modifying them.
5. The user is the authority on scope: if a task says "leave the known bugs", leave them.

## 13. Session history (what the opencode session did — for continuity)

1. Built the full stack via contract-first parallel waves (25-table schema + Alembic migrations
   first; then ingestion/knowledge/authority, handover/assistant, all frontend pages).
2. Finishing pass: fixed pytest suite (teardown FK ordering, shared-client cookie bug, member-upload
   expectation), added missing `GET /projects/{id}/graph` endpoint, wiped agent-junk rows from dev DB,
   pre-seeded demo data, wrote real README, verified everything (pytest 10/10, build, lint, e2e
   30/30 + 11/11, graph live-render smoke).
3. Git: `git init` + 4 staged pushes to CODERSINPUNE_TEAM-ZERO at 26% → 46% → 75.6% → **100%**,
   with secret/junk screening at each step; final fresh-clone verification (§4).
4. Fixed landing CTAs (all buttons now navigate: `/login` `/signup` /scroll — modal removed from
   flows), updated Playwright step-10 + 401 filter, re-greened both suites.
5. Restored dev servers (uvicorn :8000, Vite :5199) — both live at handoff.

## 14. First-message reply format (context loaded proof)

Reply with exactly this shape, then wait:

```
CONTEXT LOADED — ProjectPulse
HEAD: <short hash> @ <remote>
Ports: frontend <port> / API <port>
Demo password: <password>
Known bugs: <two from §10>
Awaiting instructions.
```
