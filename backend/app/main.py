from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.calendar.router import router as calendar_router
from app.calendar.suggest import router as calendar_suggest_router
from app.calendar.summary import router as calendar_summary_router
from app.routers import profile, users
from app.timeline.media import router as timeline_media_router
from app.timeline.router import router as timeline_router
from app.todo.planner import router as todo_planner_router
from app.todo.quick_add import router as todo_quick_add_router
from app.todo.routines import router as todo_routines_router
from app.todo.router import router as todo_router

settings = get_settings()

app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users.router)
app.include_router(profile.router)
app.include_router(timeline_router)
app.include_router(timeline_media_router)
app.include_router(todo_router)
app.include_router(todo_routines_router)
app.include_router(todo_planner_router)
app.include_router(todo_quick_add_router)
app.include_router(calendar_router)
app.include_router(calendar_summary_router)
app.include_router(calendar_suggest_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
