# رَاصِد — Rased

**AI-Powered Video Monitoring & Analytics SaaS**

Rased is an intelligent monitoring platform that combines real-time video surveillance with AI-powered analytics. It provides multi-tenant support for organizations to manage cameras, detect events, and gain actionable insights from their video feeds.

---

## 🏗️ Architecture

```
rased/
├── apps/
│   ├── api/          # Go backend (Fiber + pgx)
│   ├── web/          # Frontend (Next.js / Nuxt)
│   └── ai/           # Python AI services
├── infrastructure/   # Docker configs & init scripts
├── docker-compose.yml
├── Makefile
└── .env.example
```

## 📋 Requirements

| Tool       | Version   |
|------------|-----------|
| Docker     | 24+       |
| Go         | 1.23+     |
| Node.js    | 20+       |
| Python     | 3.12+     |
| Make       | any       |

## 🚀 Quick Start

### 1. Clone & configure

```bash
cp .env.example .env
```

### 2. Start infrastructure

```bash
# Start all services (Postgres, Redis, EMQX, MinIO, MediaMTX)
make up

# Or directly:
docker compose up -d
```

### 3. Run migrations

```bash
make migrate-up
```

### 4. Start the API

```bash
make api
```

### 5. Start the web app

```bash
make web
```

## 🔗 Local Services

| Service            | URL                          | Credentials              |
|--------------------|------------------------------|--------------------------|
| **API**            | http://localhost:8080         | —                        |
| **Web App**        | http://localhost:3000         | —                        |
| **PostgreSQL**     | localhost:5432               | `rased` / `rased`        |
| **Redis**          | localhost:6379               | —                        |
| **EMQX Dashboard** | http://localhost:18083       | `admin` / `public`       |
| **EMQX MQTT**     | localhost:1883               | —                        |
| **EMQX WebSocket** | localhost:8083              | —                        |
| **MinIO Console**  | http://localhost:9001        | `rased` / `rased123456`  |
| **MinIO API**      | http://localhost:9000        | `rased` / `rased123456`  |
| **MediaMTX RTSP**  | rtsp://localhost:8554        | —                        |
| **MediaMTX WebRTC**| http://localhost:8889        | —                        |
| **MediaMTX HLS**   | http://localhost:8888        | —                        |
| **MediaMTX API**   | http://localhost:9997        | —                        |

## 🛠️ Makefile Commands

```bash
make up            # Start all Docker services
make down          # Stop all Docker services
make logs          # Follow Docker logs
make api           # Run Go API server
make web           # Run frontend dev server
make migrate-up    # Run database migrations
make migrate-down  # Rollback database migrations
```

## 📡 MQTT Topics

```
rased/{company_id}/{branch_id}/cameras/{camera_id}/status
rased/{company_id}/{branch_id}/cameras/{camera_id}/events
rased/{company_id}/{branch_id}/alerts
```

## 📄 License

Proprietary — All rights reserved.
