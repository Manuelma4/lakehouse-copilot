FROM python:3.11-slim-bookworm AS python-base
WORKDIR /app
COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir .
COPY scripts/export_web_snapshot.py ./scripts/export_web_snapshot.py
COPY scripts/export_openfootball.py ./scripts/export_openfootball.py
RUN python scripts/export_web_snapshot.py --output /tmp/arena-snapshot.json
RUN python scripts/export_openfootball.py --output /tmp/arena-open-football.json

FROM node:24-bookworm-slim AS web-build
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web ./
COPY --from=python-base /tmp/arena-snapshot.json ./public/snapshot.json
COPY --from=python-base /tmp/arena-open-football.json ./public/open-football.json
RUN npm run build

FROM python-base AS runtime
COPY --from=web-build /web/dist ./web/dist
ENV ARENA_STATE=/app/data/copilot
ENV ARENA_WEB_DIST=/app/web/dist
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "arena_copilot.api:app", "--host", "0.0.0.0", "--port", "8000"]
