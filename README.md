# 360Events

**360Events** is an event ticketing platform being reengineered for the Nigerian market. The project is being developed as a TypeScript monorepo with a modular backend, a React web client, and a dedicated background worker.

<sub>Current status: early development. The repository contains foundational infrastructure; the complete event discovery, booking, payment, ticketing, and organiser workflows are not implemented yet.</sub>

## Project Direction

The target platform is intended to support customers, event organisers, and administrators. Its business and technical requirements are documented separately so implementation can proceed in verifiable stages.

The architecture prioritises:

- Correct ticket inventory and order state transitions.
- Reliable payment processing and reconciliation.
- Explicit fee, refund, and organiser payout rules.
- Clear separation between business modules.
- PostgreSQL as the source of truth.
- Idempotent background processing and auditable operations.
- Security, privacy, and Nigerian regulatory considerations.

These are target design principles, not a claim that every listed workflow is already available in the application.

## Current Implementation

The codebase currently includes:

- A pnpm workspace with separate API, web, worker, and shared packages.
- An Express API foundation with liveness and database-readiness endpoints.
- PostgreSQL integration using Drizzle ORM and committed migrations.
- Initial audit-event and transactional-outbox database structures.
- A worker runner that claims outbox jobs using database leases, retries, and graceful shutdown.
- A minimal React/Vite client that checks API readiness.
- Shared TypeScript types and Zod validation packages.
- Vitest, ESLint, and TypeScript verification scripts.

The API currently exposes:

- `GET /health/live` — confirms that the API process is running.
- `GET /health/ready` — checks database connectivity.

The end-user ticketing workflows remain future implementation work.

## Technology

| Area | Technology |
|---|---|
| Runtime | Node.js 22+ |
| Language | TypeScript |
| Package manager | pnpm workspaces |
| API | Express 5 |
| Web | React 18, Vite, React Router |
| Database | PostgreSQL 16, Drizzle ORM |
| Validation | Zod |
| Background work | Dedicated Node.js worker, PostgreSQL transactional outbox |
| Logging | Pino |
| Testing | Vitest, Supertest |
| Quality | ESLint, TypeScript |

Redis is part of the target architecture where justified, but it is not currently a required dependency in the local development compose file.

## Repository Structure

```text
.
├── apps/
│   ├── api/          # Express API, database schema, migrations and tests
│   ├── web/          # React + Vite client
│   └── worker/       # Background outbox worker
├── packages/
│   ├── config/       # Shared TypeScript configuration
│   ├── types/        # Shared types and contracts
│   └── validators/   # Shared validation schemas
├── docs/
│   ├── architecture.md
│   ├── business-requirements-and-rules.md
│   ├── database-roles.md
│   ├── deployment.md
│   └── implementation-plan.md
├── docker-compose.yml
└── pnpm-workspace.yaml
```

## Getting Started

### Prerequisites

- Node.js 22 or newer
- pnpm 9 or newer
- Docker and Docker Compose

Enable Corepack and install workspace dependencies:

```bash
corepack enable
pnpm install
```

### 1. Configure the database

Start PostgreSQL:

```bash
docker compose up -d
```

The local database is exposed on port `5435`. The connection string used by the current development setup is:

```text
postgres://postgres:postgres@localhost:5435/360events_dev
```

The API and worker load environment variables from their respective working directories. Create local environment files:

```bash
cp .env.example apps/api/.env
cp .env.example apps/worker/.env
```

Set `DATABASE_URL` in both files to the connection string above. The API uses `PORT` (default `3000`); the worker status endpoint uses `WORKER_PORT` (default `3001`).

### 2. Apply database migrations

```bash
pnpm --filter @360events/api db:migrate
```

### 3. Start the workspace

```bash
pnpm dev
```

The API, web client, and worker development processes run in parallel. The API defaults to port `3000`; the Vite client prints its local URL when it starts.

## Verification

Run the repository's verification pipeline:

```bash
pnpm verify
```

Individual commands are also available:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Project Documentation

- [Business requirements and rules](docs/business-requirements-and-rules.md)
- [Target system architecture](docs/architecture.md)
- [Implementation plan](docs/implementation-plan.md)
- [Database roles](docs/database-roles.md)
- [Deployment notes](docs/deployment.md)

The architecture and business documents describe the intended platform. Refer to the **Current Implementation** section above when distinguishing implemented code from planned functionality.

## Project Status

This is an active development project. The immediate focus is on establishing a reliable foundation and implementing the platform in small, testable slices. It is not yet ready for real customer payments or production ticket sales.
