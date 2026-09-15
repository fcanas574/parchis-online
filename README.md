# Parchís Online

Parchís Online Fase 1 establece el monorepo y los shells iniciales para el cliente Next.js y la API FastAPI. Esta fase incluye únicamente el health check del backend y una página temporal de inicio; las salas, partidas y funciones sociales se implementarán en fases posteriores.

Para desarrollo local:

```bash
pnpm frontend:dev
uv run --project backend uvicorn app.main:app --reload
```

El estado de las salas en memoria es intencionalmente temporal y no requiere PostgreSQL ni Redis para ejecutar esta fase.
