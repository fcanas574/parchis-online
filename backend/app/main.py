import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import practice, rooms, websocket
from app.config import settings


def configure_application_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s: %(name)s: %(message)s",
    )


configure_application_logging()

app = FastAPI(title="Parchís Online API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(rooms.router)
app.include_router(practice.router)
app.include_router(websocket.router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
