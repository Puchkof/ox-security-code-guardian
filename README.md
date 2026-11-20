# Code Guardian

A backend service that wraps the [Trivy](https://trivy.dev) scanner. You give it a GitHub repository; it
clones the repo, runs Trivy, **stream-parses the (potentially 500MB+) JSON report**, and stores only the
`CRITICAL` vulnerabilities. It is built to run in a 200MB container with `--max-old-space-size=150`.

OX Security home assignment. Stack: TypeScript (strict, no `any`) · NestJS 11 · BullMQ + Redis ·
PostgreSQL + Prisma · stream-json · React (Vite).

| Requirement                                                              | Where                                                                                                                                                             |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/scan`: non-blocking, returns `{scanId, status: "Queued"}`     | [`scan.controller.ts`](apps/api/src/scan/http/scan.controller.ts) → [`StartScanHandler`](packages/core/src/application/commands/start-scan/start-scan.handler.ts) |
| Background job: clone → Trivy → stream-parse → store CRITICAL → clean up | [`ScanProcessor`](apps/worker/src/scan/scan.processor.ts) → [`ExecuteScanHandler`](packages/core/src/application/commands/execute-scan/execute-scan.handler.ts)   |
| No `fs.readFile` / `JSON.parse` on results; Node streams                 | [`StreamingTrivyReportParser`](packages/infrastructure/src/trivy/streaming-trivy-report-parser.ts), enforced by [ESLint](eslint.config.mjs)                       |
| `GET /api/scan/:scanId`: status + criticals when finished                | [`GetScanHandler`](packages/core/src/application/queries/get-scan/get-scan.handler.ts)                                                                            |
| Bonus A: React app, polls every 2s                                       | [`apps/web`](apps/web/src/hooks/useScanPolling.ts)                                                                                                                |
| Bonus B: GraphQL                                                         | [`scan.resolver.ts`](apps/api/src/scan/graphql/scan.resolver.ts) at `/graphql`                                                                                    |
| Bonus C: `docker-compose.yml` with `mem_limit: 200m`                     | [`docker-compose.yml`](docker-compose.yml)                                                                                                                        |
| Self-test: `node --max-old-space-size=150 dist/index.js`                 | [`src/index.ts`](src/index.ts)                                                                                                                                    |

## Quick start (Docker)

Prerequisite: Docker with Compose v2.

```bash
docker compose up -d --build
```

- API at http://localhost:3000 (REST `/api/scan`, GraphQL `/graphql`, health `/health`)
- Web UI at http://localhost:8080
- The first start downloads the Trivy vulnerability DB into `trivy-server`, which can take a minute.

```bash
curl -s -XPOST localhost:3000/api/scan -H 'content-type: application/json' \
  -d '{"repoUrl":"https://github.com/Puchkof/NodeGoat"}'
# {"scanId":"6d86221a-…","status":"Queued"}

curl -s localhost:3000/api/scan/6d86221a-…
# {"status":"Finished","criticalCount":12,"criticalVulnerabilities":[{"vulnerabilityId":"CVE-2020-7610","pkgName":"bson",…}],…}
```

Postgres and Redis are published on host ports **15432** and **16379**, chosen to avoid clashing with other
local services. Override them with `POSTGRES_HOST_PORT` / `REDIS_HOST_PORT`.

## Architecture

```
            ┌──────────── apps/api (APP_MODE=api) ────────────┐       ┌──── apps/worker (APP_MODE=worker) ────┐
 HTTP ────▶ │ ScanController / ScanResolver   (Controller)    │       │ ScanProcessor  (Worker: BullMQ)        │
            │        │ CommandBus / QueryBus                   │       │        │ CommandBus                   │
            │        ▼                                         │       │        ▼                              │
            │ StartScanHandler · GetScanHandler  (Service)     │       │ ExecuteScanHandler  (Service)          │
            └────────┬──────────────────────────────┬──────────┘       └───┬───────────┬──────────────┬────────┘
                     │ enqueue(jobId = scanId)      │ read                 │ consume   │ clone / scan │ stream
                     ▼                              ▼                      │           ▼              ▼
                   Redis (BullMQ) ◀───────────────────────────────────────┘     git, trivy ──▶ report.json (disk)
                                              PostgreSQL ◀── batched INSERTs (500 criticals each)
```

**Clean Architecture with CQS**, in a pnpm monorepo:

| Package                                              | Layer                                                                                                                                       | Depends on           |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| [`packages/core`](packages/core)                     | Domain (`Scan` aggregate + state machine, `RepoUrl`) and application (commands, queries, **ports**). Pure TypeScript, no framework imports. | nothing              |
| [`packages/infrastructure`](packages/infrastructure) | Adapters for the ports: streaming Trivy parser, Trivy/git CLIs, Prisma repositories, BullMQ producer, temp workspaces                       | core                 |
| [`packages/nest-common`](packages/nest-common)       | Nest glue shared by both apps: DI tokens, CQRS binding of plain core handlers, persistence/system modules                                   | core, infrastructure |
| [`apps/api`](apps/api)                               | Driving adapter: REST + GraphQL over `CommandBus`/`QueryBus`                                                                                | core, nest-common    |
| [`apps/worker`](apps/worker)                         | Driving adapter: BullMQ consumer turning jobs into `ExecuteScanCommand`                                                                     | core, nest-common    |
| [`apps/web`](apps/web)                               | React client (REST, 2s polling)                                                                                                             | API contract only    |
| [`src/index.ts`](src/index.ts)                       | Composition root: starts the API, the worker, or both (`APP_MODE`)                                                                          | api, worker          |

Mapping to the brief's **Controller / Service / Worker**: controllers and resolvers only validate and
dispatch. The use-case handlers are the services and contain all orchestration. The worker is a thin
BullMQ transport. Core handlers are plain classes bound to `@nestjs/cqrs` by
[`cqrs-binding.ts`](packages/nest-common/src/cqrs-binding.ts), so the business logic can be unit-tested
without Nest, Redis or Postgres.

### Scan lifecycle

```
Queued ──start──▶ Scanning ──finish──▶ Finished
  ▲                  │ └──fail───────▶ Failed
  └────requeue───────┘   (transient error, retry pending; failureReason shows the last error)
```

Transitions are enforced by the [`Scan`](packages/core/src/domain/scan.ts) aggregate. Two more rules keep
concurrent attempts safe:

- **Optimistic concurrency:** every write is `UPDATE … WHERE id = ? AND version = ?`. If a newer attempt
  takes over (a stalled job redelivered while the old worker is still alive), the old attempt's next write is
  rejected and it stops without touching the scan.
- **Run ids:** each attempt writes its findings under a fresh `run_id`, and readers only see the run
  recorded on the scan. A half-finished or superseded attempt can never mix its rows into the result.

No scan stays `Queued`/`Scanning` forever. When BullMQ gives up on a job (last attempt, or stalled more
than `maxStalledCount` after repeated worker crashes), the worker marks the scan `Failed`. A periodic
**reaper** ([`ReapStuckScansHandler`](packages/core/src/application/commands/reap-stuck-scans/reap-stuck-scans.handler.ts))
also compares the database with the queue. It fails `Scanning` scans past the sum of all timeouts, and
`Queued` scans whose job no longer exists.

## Memory: how the 500MB+ report is handled

```
fs.createReadStream(16KB chunks) → stream-json tokenizer → Ignore(Description, CVSS, References…)
    → Pick(Results.N.Target | Results.N.Vulnerabilities.M) → StreamValues → type guard → severity filter
    → inBatches(500) → await INSERT (backpressure pauses the file stream)
```

- One finding is assembled at a time, never a whole `Result`, because a single lockfile can hold tens of
  thousands of findings. Heavy fields are dropped at the token level and are never built into JS objects.
- Awaiting each batch insert pauses the stream, so memory is bounded by the read chunk plus one batch.
- `JSON.parse` and `fs.readFile*` are banned by an ESLint rule across the backend
  ([eslint.config.mjs](eslint.config.mjs)), not only by convention.
- The Trivy **DB runs in a separate `trivy-server` container** (client/server mode), so the worker's
  200MB budget is spent on the Node pipeline, not on Trivy's vulnerability database.

### Measured

| Test                                                                                        | Limit                      | Result                                           |
| ------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------ |
| Parser only, 583MB report (335k findings)                                                   | `--max-old-space-size=150` | ✅ 36MB peak heap, 77MB RSS, ~51MB/s             |
| Parser only, **2GB** report (1.18M findings)                                                | `--max-old-space-size=150` | ✅ 40MB peak heap, 78MB RSS: flat as size grows  |
| Naive `JSON.parse(readFile)` on 583MB                                                       | `--max-old-space-size=150` | ❌ heap OOM within 100ms                         |
| **Full worker in Docker** (clone + 583MB report + 6,700 inserts)                            | `mem_limit: 200m`          | ✅ 90MiB container peak, no OOM kill, 33s        |
| **`node --max-old-space-size=150 dist/index.js`** (API + worker, one process, 583MB report) | heap 150MB                 | ✅ Finished, 6,700 criticals                     |
| Real scan of NodeGoat in Docker                                                             | `mem_limit: 200m`          | ✅ 12 criticals, worker peak 59MiB               |
| Worker SIGKILLed once mid-scan (583MB drill)                                                | `mem_limit: 200m`          | ✅ job redelivered, Finished, exactly 6,700 rows |
| Worker SIGKILLed during two consecutive attempts                                            | `mem_limit: 200m`          | ✅ `Failed`: "Scan was interrupted repeatedly"   |

Details and the chunk-size finding (64KB chunks peaked at 97MB of heap, 16KB chunks at 36MB) are in
[docs/benchmarks.md](docs/benchmarks.md).

### Reproduce

```bash
pnpm install && pnpm bench:build
pnpm bench:gen      # streams a 583MB Trivy-shaped report to fixtures/generated/ (gitignored)
pnpm bench:parse    # node --max-old-space-size=150 … parse-benchmark.js
pnpm bench:naive    # the forbidden approach, crashes

# OOM drill: the real worker in its 200MB container, with Trivy's output replaced by the 583MB report
docker compose -f docker-compose.yml -f docker-compose.oom.yml up -d worker
curl -s -XPOST localhost:3000/api/scan -H 'content-type: application/json' \
  -d '{"repoUrl":"https://github.com/Puchkof/NodeGoat"}'
docker stats code-guardian-worker-1
docker compose up -d worker   # back to the real Trivy
```

## Running on the host (the brief's self-test)

Requires Node 22, pnpm 10, git, and a Trivy CLI if you want real scans (`brew install trivy`).

```bash
pnpm install
pnpm dev:deps                              # postgres, redis, trivy-server in Docker
cp .env.example .env && set -a && source .env && set +a
pnpm db:migrate
pnpm build
node --max-old-space-size=150 dist/index.js   # API + worker in one process (APP_MODE=all)
```

Web UI in dev mode: `pnpm -C apps/web dev` (http://localhost:5173).

## API

### REST

| Method | Path                                                                | Response                                                                                                                                    |
| ------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/scan` body `{"repoUrl": "https://github.com/<owner>/<repo>"}` | `202 {"scanId","status":"Queued"}`                                                                                                          |
| `GET`  | `/api/scan/:scanId?limit=100&cursor=`                               | `200 {id, repoUrl, status, failureReason, criticalCount, createdAt, updatedAt, startedAt, finishedAt, criticalVulnerabilities, nextCursor}` |
| `GET`  | `/health`                                                           | `200` liveness                                                                                                                              |

`criticalVulnerabilities` is `null` until the scan is `Finished`. The list uses keyset pagination
(`limit` ≤ 500, `cursor` = previous `nextCursor`), so a repository with thousands of criticals never produces
one huge response. Errors share one shape: `{"error": {"code", "message"}}`.

### GraphQL (`POST /graphql`)

```graphql
mutation {
  startScan(repoUrl: "https://github.com/Puchkof/NodeGoat") {
    scanId
    status
  }
}

query {
  scan(id: "…", first: 50) {
    id
    status
    failureReason
    criticalCount
    nextCursor
    criticalVulnerabilities {
      vulnerabilityId
      pkgName
      installedVersion
      fixedVersion
      severity
      title
      primaryUrl
      target
    }
  }
}
```

## Error handling

| Situation                                                                                                    | Behaviour                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URL is not `https://github.com/<owner>/<repo>` (ssh, file://, credentials, query strings, option-like names) | `400 INVALID_REPO_URL`, never enqueued. Strict validation also prevents `git` argument injection.                                                                                                                                                                    |
| Redis down when queueing                                                                                     | Enqueue times out after 5s, scan marked `Failed`, `503 QUEUE_UNAVAILABLE`                                                                                                                                                                                            |
| Repo missing or private                                                                                      | `git` stderr classified as permanent → `Failed` at once (BullMQ `UnrecoverableError`, no wasted retries)                                                                                                                                                             |
| Network flake on clone or Trivy DB                                                                           | Retryable → status back to `Queued` with the reason; 3 attempts, exponential backoff                                                                                                                                                                                 |
| Trivy exits non-zero, or exits 0 without writing a report                                                    | Retried; the last 8KB of stderr goes to logs only                                                                                                                                                                                                                    |
| Trivy not installed                                                                                          | Non-retryable `SCANNER_UNAVAILABLE`                                                                                                                                                                                                                                  |
| Clone or scan exceeds its timeout                                                                            | Child process **group** gets SIGTERM, then SIGKILL; `SCAN_TIMEOUT`                                                                                                                                                                                                   |
| **Disk full**                                                                                                | `statfs` free-space check before each scan (`MIN_FREE_BYTES`) and `ENOSPC` mapping at every step → `INSUFFICIENT_STORAGE`, retried later                                                                                                                             |
| Corrupt or truncated report                                                                                  | `REPORT_PARSE_FAILED`; partially stored findings are deleted                                                                                                                                                                                                         |
| Malformed individual findings                                                                                | Skipped and counted in a log warning; the scan still succeeds                                                                                                                                                                                                        |
| Worker crash or OOM kill mid-scan                                                                            | BullMQ redelivers the stalled job; the new attempt takes over under a fresh run id (version-checked writes stop the old one). After `maxStalledCount` is exceeded the scan is marked `Failed`; the reaper is the backstop. Orphaned workspaces are swept at startup. |
| Any failure                                                                                                  | `failureReason` is a fixed public message per error code (no stderr, paths or hostnames); details are logged. The workspace (repo + report) is removed in `finally`.                                                                                                 |
| Shutdown (SIGTERM)                                                                                           | Worker stops taking jobs and waits for the active scan up to `stop_grace_period` (2m), then the API closes. A scan cut off by the deadline is redelivered like any stalled job.                                                                                      |
| Unknown id / bad cursor                                                                                      | `404 SCAN_NOT_FOUND` / `400 INVALID_CURSOR`; unexpected errors become a generic 500                                                                                                                                                                                  |

## Testing

```bash
pnpm lint && pnpm typecheck && pnpm test   # 120+ tests; Testcontainers specs need Docker
pnpm -C apps/web test
```

- **Unit:** domain state machine, URL validation, handlers against in-memory fakes (retry vs final failure,
  cleanup, ENOSPC, idempotency), the streaming parser (malformed, truncated and huge input, abort, early exit),
  and process/git/Trivy error mapping with fake binaries.
- **Integration:** Prisma repositories and the BullMQ queue against real Postgres and Redis (Testcontainers).
- **E2E:** REST and GraphQL through Nest + supertest; the processor's retry/unrecoverable mapping.

## Design decisions and trade-offs

- **BullMQ + Redis rather than in-process jobs:** the API and the worker scale and fail independently, jobs
  survive restarts, and retries/backoff/stalled-job recovery come for free.
- **Postgres for results:** only criticals are stored (small), written in batches, read with keyset
  pagination served by an index on `(scan_id, id)`.
- **Trivy client/server mode:** keeps the vulnerability DB (hundreds of MB) out of the 200MB worker.
- **Severity filtering in the stream rather than with `trivy --severity CRITICAL`:** the assignment asks for
  stream filtering. In production, also passing `--severity CRITICAL` would shrink the report at the source.
- **One backend image, two roles:** `APP_MODE` picks `api`, `worker` or `all`. The same build backs Compose
  and the single-process self-test.
- **Save and enqueue are two steps.** If Redis fails, the scan is marked `Failed` and the client gets 503.
  An enqueue that timed out but landed is detected by the version check, and the client gets 202. A crash
  between the two steps leaves a `Queued` row with no job, which the reaper fails after `QUEUED_GRACE_MS`.
  A transactional outbox would remove the gap entirely.

## What's next

Transactional outbox · auth and per-tenant rate limiting · readiness probes for Postgres/Redis/Trivy ·
metrics (queue depth, scan duration, parse throughput) · S3-backed workspaces for very large repos ·
`--severity` pre-filtering · TTL cleanup of old scans.

## Project layout

```
apps/api            REST + GraphQL (NestJS)
apps/worker         BullMQ consumer (NestJS standalone)
apps/web            React + Vite client
packages/core       domain + use cases + ports (framework-free)
packages/infrastructure  Trivy/git/Prisma/BullMQ/fs adapters, streaming parser, benchmarks
packages/nest-common     shared Nest wiring
src/index.ts        single-process entrypoint → dist/index.js
docs/benchmarks.md  memory measurements
```
