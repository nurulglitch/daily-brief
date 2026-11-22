FROM ghcr.io/astral-sh/uv:0.9.2 AS uv
FROM python:3.13-slim
COPY --from=uv /uv /uvx /bin/
WORKDIR /app
COPY . .
RUN uv sync --frozen --no-dev
ENTRYPOINT ["uv", "run", "--no-sync", "brief"]
CMD ["run"]
