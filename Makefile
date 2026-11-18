.PHONY: up down logs api web migrate-up migrate-down ps clean api-logs api-restart api-build desktop desktop-install desktop-build

# ---- Docker ----

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f

ps:
	docker compose ps

clean:
	docker compose down -v

# ---- API ----

api:
	@if command -v go > /dev/null 2>&1; then \
		cd apps/api && go run cmd/server/main.go; \
	else \
		echo "Go is not installed locally. Running API via Docker Compose..."; \
		docker compose up -d api && docker compose logs -f api; \
	fi

api-build:
	docker compose build api

api-restart:
	docker compose up -d --force-recreate api

api-logs:
	docker compose logs -f api

# ---- Web ----

web:
	cd apps/web && npm run dev

# ---- Edge AI Agent ----

agent:
	cd services/edge-agent && python3 agent_runner.py

agent-simulate:
	cd services/edge-agent && python3 simulate_events.py

# ---- Desktop App (Windows) ----

desktop-install:
	cd apps/desktop && npm install

desktop:
	cd apps/desktop && env -u ELECTRON_RUN_AS_NODE DISPLAY=:0 npm start

desktop-build:
	cd apps/desktop && npm run build

# ---- Migrations ----

migrate-up:
	docker compose exec -T postgres psql -U rased -d rased < apps/api/pkg/database/migrations/001_initial_schema.up.sql
	docker compose exec -T postgres psql -U rased -d rased < apps/api/pkg/database/migrations/002_tasks_and_notifications.up.sql

migrate-down:
	docker compose exec -T postgres psql -U rased -d rased < apps/api/pkg/database/migrations/002_tasks_and_notifications.down.sql
	docker compose exec -T postgres psql -U rased -d rased < apps/api/pkg/database/migrations/001_initial_schema.down.sql
