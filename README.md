# Me

A personal life hub web app. The first module is a zoomable life timeline with events, descriptions and photos. To-do and calendar modules are planned.

- **Frontend:** Next.js + TypeScript + Tailwind (`frontend/`)
- **Backend:** Python + FastAPI (`backend/`)
- **Database, auth, storage:** Supabase

## Local setup

Copy `backend/.env.example` to `backend/.env` and `frontend/.env.example` to `frontend/.env.local`, then fill in your Supabase project URL and publishable key.

```bash
# backend (http://localhost:8000)
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload
.venv/bin/pytest            # tests

# frontend (http://localhost:3000)
cd frontend
npm install
npm run dev
```
