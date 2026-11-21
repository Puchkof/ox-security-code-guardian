# Code Guardian

A service that wraps the [Trivy](https://trivy.dev) scanner. Give it a GitHub repo and it clones it, runs Trivy,
**stream-parses the (500MB+) JSON report** and stores only `CRITICAL` vulnerabilities. It is built to run in a
200MB container with `--max-old-space-size=150`.

TypeScript (strict, no `any`) · NestJS · BullMQ + Redis · PostgreSQL + Prisma · stream-json · React.

| Requirement                                                         | Where                                                                                                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/scan` returns `{scanId, status: "Queued"}` right away    | [controller](apps/api/src/scan/http/scan.controller.ts) → [`StartScanHandler`](packages/core/src/application/commands/start-scan/start-scan.handler.ts) |
| Background clone → Trivy → stream-parse → store CRITICAL → clean up | [worker](apps/worker/src/scan/scan.processor.ts) → [`ExecuteScanHandler`](packages/core/src/application/commands/execute-scan/execute-scan.handler.ts)  |
| Streams only, no `readFile`/`JSON.parse` on results                 | [`StreamingTrivyReportParser`](packages/infrastructure/src/trivy/streaming-trivy-report-parser.ts), enforced by [ESLint](eslint.config.mjs)             |
| `GET /api/scan/:scanId` returns status + criticals                  | [`GetScanHandler`](packages/core/src/application/queries/get-scan/get-scan.handler.ts)                                                                  |
| Bonuses: React (2s polling), GraphQL, `mem_limit: 200m`             | [`apps/web`](apps/web), [`/graphql`](apps/api/src/scan/graphql/scan.resolver.ts), [`docker-compose.yml`](docker-compose.yml)                            |

## Run it

```bash
docker compose up -d --build        # API :3000 · UI http://localhost:8080 (first start downloads the Trivy DB, ~1 min)

curl -s -XPOST localhost:3000/api/scan -H 'content-type: application/json' \
  -d '{"repoUrl":"https://github.com/Puchkof/NodeGoat"}'      # → {"scanId":"…","status":"Queued"}
curl -s localhost:3000/api/scan/<scanId>                      # → {"status":"Finished","criticalCount":12,…}
```

**The brief's self-test** (API + worker in one process; needs Node 22, pnpm 10, git and Trivy on the host):

```bash
pnpm install && pnpm dev:deps                     # postgres, redis, trivy-server in Docker
cp .env.example .env && set -a && source .env && set +a
pnpm db:migrate && pnpm build
node --max-old-space-size=150 dist/index.js       # APP_MODE=all | api | worker
```

Postgres and Redis are published on host ports 15432 and 16379, to avoid clashing with local services.

## Architecture

Clean Architecture with CQS (commands and queries kept separate), in a pnpm monorepo:

- [`packages/core`](packages/core): domain (`Scan` state machine, `RepoUrl`) and use cases behind **ports**.
  No framework imports, so it is unit-tested without Nest, Redis or Postgres.
- [`packages/infrastructure`](packages/infrastructure): adapters for the streaming parser, git/Trivy CLIs,
  Prisma, BullMQ and temp workspaces.
- [`apps/api`](apps/api) (REST + GraphQL) and [`apps/worker`](apps/worker) (BullMQ consumer): thin delivery
  layers over `CommandBus`/`QueryBus`. Shared Nest wiring is in [`packages/nest-common`](packages/nest-common).
- [`src/index.ts`](src/index.ts): one build, three roles (`APP_MODE`), used by Compose and by the self-test.

**Controller / Service / Worker** from the brief maps to controllers and resolvers (validate and dispatch),
use-case handlers (all orchestration), and a thin BullMQ processor.

```
Queued ──▶ Scanning ──▶ Finished
  ▲           │ └────▶ Failed
  └─requeue───┘  (transient error, retry pending)
```

Concurrent attempts are safe:

- Every write is version-checked (`WHERE id = ? AND version = ?`).
- Each attempt stores its findings under its own `run_id`, so a stale attempt never mixes rows into the result.
- No scan stays stuck: when BullMQ gives up on a job the scan is marked `Failed`, and a periodic
  [reaper](packages/core/src/application/commands/reap-stuck-scans/reap-stuck-scans.handler.ts) compares the
  database with the queue.

## Memory

```
createReadStream(16KB) → stream-json → Ignore(Description, CVSS, …) → Pick(one finding at a time)
  → type guard → severity filter → batches of 500 → await INSERT (backpressure pauses the stream)
```

- **Bounded memory:** memory never holds more than one read chunk and one batch, whatever the file size.
  Heavy fields are dropped before they become JS objects.
- **Trivy client/server mode:** the vulnerability DB lives in the `trivy-server` container, outside the
  worker's 200MB budget.

| Test                                                        | Limit      | Result                                     |
| ----------------------------------------------------------- | ---------- | ------------------------------------------ |
| Parser, 583MB / **2GB** report                              | heap 150MB | ✅ 36MB / 40MB peak heap (flat)            |
| Naive `JSON.parse(readFile)`, 583MB                         | heap 150MB | ❌ out of memory in 100ms                  |
| Full worker in Docker, 583MB report, 6,700 inserts          | 200MB      | ✅ 91MiB peak                              |
| `node --max-old-space-size=150 dist/index.js`, 583MB report | heap 150MB | ✅ Finished                                |
| Worker killed (SIGKILL) once / twice mid-scan               | 200MB      | ✅ recovers, exactly 6,700 rows / `Failed` |

Reproduce with `pnpm bench:build && pnpm bench:gen && pnpm bench:parse` (and `pnpm bench:naive` for the crash).
For the Docker run, use `docker compose -f docker-compose.yml -f docker-compose.oom.yml up -d worker`.
Details are in [docs/benchmarks.md](docs/benchmarks.md).

## API

- `POST /api/scan` `{"repoUrl":"https://github.com/<owner>/<repo>"}` → `202 {scanId, status}`
- `GET /api/scan/:scanId?limit=100&cursor=` → status, `failureReason`, `criticalCount`, and
  `criticalVulnerabilities` (`null` until Finished, paginated via `nextCursor`)
- `POST /graphql`: `startScan(repoUrl)` and `scan(id, first, after) { status criticalVulnerabilities { … } }`
- Errors: `{"error": {"code", "message"}}`

## Error handling

- **Invalid URL** (ssh, `file://`, credentials, extra path, option-like names): `400`, never queued. This also
  blocks git argument injection.
- **Repo missing or private:** fails at once, no wasted retries.
- **Network flakes:** 3 attempts with exponential backoff.
- **Trivy fails, hangs or is missing:** stderr goes to logs only. Timeouts kill the whole process group.
- **Disk full:** a free-space check before each scan, plus `ENOSPC` handling at every step → `INSUFFICIENT_STORAGE`.
- **Corrupt report:** fails and removes partial results. Malformed single findings are skipped.
- **Worker crash:** the job is redelivered. After repeated crashes the scan is `Failed`. Leftover workspaces
  are swept when the worker starts.
- **Redis down on submit:** `503`, scan marked `Failed`.
- **Always:** the workspace is deleted. `failureReason` is a fixed public message, never internals.

## Testing

```bash
pnpm lint && pnpm typecheck && pnpm test    # 149 tests: unit, Testcontainers (Postgres/Redis), e2e
pnpm -C apps/web test
```

## Trade-offs and next steps

- **BullMQ + Redis:** the API and worker scale and fail independently, and retries come for free.
- **Postgres:** stores only criticals, with keyset pagination.
- **Stream filtering instead of `trivy --severity CRITICAL`:** the brief asks for stream filtering. In
  production you would do both.
- **Save then enqueue is two steps:** the reaper covers a crash in between.

**Next:** transactional outbox · auth and rate limiting · readiness probes · metrics · S3 workspaces ·
cleanup of old scans.
