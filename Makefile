# Campus Portal: everyday commands. `make` or `make help` lists them.
# Development runs the backing services in Docker and the API and web app on this machine
# (docs/06 §6.4). Production runs on Dokploy (docs/06 §6.7): only `prod-env` is for that.

.DEFAULT_GOAL := help
# Some shells alias make to `make -j`; these steps depend on each other, so never run them in parallel.
.NOTPARALLEL:
SHELL := /bin/bash

API := cd api &&
WEB := cd web &&
SERVICES := postgres redis s3 authentik-db authentik-server authentik-worker

.PHONY: help install up down logs dev api web migrate seed accounts setup reset \
	test test-api test-web lint format check gen-api build prod-env clean

help: ## List the commands
	@awk 'BEGIN {FS = ":.*## "} /^[a-z-]+:.*## / {printf "  \033[1m%-10s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# --- first time ---------------------------------------------------------------------------------

install: ## Install API and web dependencies
	$(API) uv sync
	$(WEB) bun install

setup: install up migrate seed accounts ## First run: dependencies, services, tables, sample data, sign-ins
	@echo "Ready. Run 'make dev', then open http://localhost:5173 (sample accounts: docs/11-test-personas.md)."

# --- running ------------------------------------------------------------------------------------

up: ## Start Postgres, Redis, S3 and Authentik in Docker
	@test -f .env || { cp .env.example .env; echo "Created .env from .env.example: replace every change-me."; }
	docker compose up -d $(SERVICES)

down: ## Stop the Docker services (data is kept)
	docker compose down

logs: ## Follow the Docker services' logs
	docker compose logs -f $(SERVICES)

dev: ## Run the API and the web app together (Ctrl-C stops both)
	@trap 'kill 0' EXIT; \
	($(API) uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000) & \
	($(WEB) bun run dev) & \
	wait

api: ## Run only the API, on :8000
	$(API) uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

web: ## Run only the web app, on :5173
	$(WEB) bun run dev

# --- data ---------------------------------------------------------------------------------------

migrate: ## Apply database migrations
	$(API) uv run alembic upgrade head

seed: ## Replace everything with the sample data from the designs (development only)
	$(API) uv run python -m app.seed

accounts: ## Authentik sign-ins for the sample accounts (password tcfl-dev-2027)
	$(API) uv run python -m app.authentik_dev

reset: seed accounts ## Back to the starting point: sample data and sign-ins

# --- quality ------------------------------------------------------------------------------------

test: test-api test-web ## Run all tests

test-api: ## API tests (needs the Postgres container)
	$(API) uv run pytest -q

test-web: ## Web tests
	$(WEB) bun run test

lint: ## Lint and type-check
	$(API) uv run ruff check . && uv run ruff format --check . && uv run ty check app
	$(WEB) bun run lint && bunx tsc -b --noEmit

format: ## Format the API code
	$(API) uv run ruff check --fix . && uv run ruff format .

gen-api: ## Regenerate the web API client from the FastAPI spec (after any API change)
	$(WEB) bun run gen:api

check: lint test ## Everything to pass before a commit
	$(WEB) bun run build

# --- production ---------------------------------------------------------------------------------

build: ## Build the production images
	docker compose -f docker-compose.prod.yml build

prod-env: ## Make .env.production with fresh secrets: make prod-env DOMAIN=https://portal.tcfl.ac.zw
	@test -n "$(DOMAIN)" || { echo "Give the domain: make prod-env DOMAIN=https://portal.tcfl.ac.zw"; exit 1; }
	@test ! -f .env.production || { echo ".env.production exists: move it away first (its secrets restore backups)."; exit 1; }
	python3 infra/new-env.py $(DOMAIN) > .env.production && chmod 600 .env.production
	@echo "Wrote .env.production (not in git). Paste it into Dokploy's Environment tab and keep a safe copy."

clean: ## Remove build output and caches (not data)
	rm -rf web/dist api/.pytest_cache api/.ruff_cache
	find api -name __pycache__ -type d -prune -exec rm -rf {} +
