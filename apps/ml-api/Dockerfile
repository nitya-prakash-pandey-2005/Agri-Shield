# Agri-SHIELD ML API — production image
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8000

# curl is used by the docker-compose healthcheck
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# Train from the committed open-data datasets at build time so the container
# serves the ML ensemble immediately (metrics are written to model_weights/metrics.json).
RUN python -c "from models.registry import registry; f, s = registry.train_candidates(); registry._save(f, s)"

RUN useradd --create-home --uid 10001 agrishield \
    && mkdir -p /app/data/cache \
    && chown -R agrishield:agrishield /app
USER agrishield

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://localhost:${PORT}/health" || exit 1

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT} --workers 1 --proxy-headers"]
