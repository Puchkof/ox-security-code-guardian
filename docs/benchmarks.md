# Memory benchmark: streaming the Trivy report

Measured on 2026-11-20 on an Apple Silicon laptop with Node 22.15. Reports are synthetic but Trivy-shaped
(`packages/infrastructure/src/trivy/fixtures/write-trivy-report.ts`), with about 1.8KB per finding and
2% of findings CRITICAL. Batches of 500 match what the worker writes to Postgres.

```bash
pnpm bench:build && pnpm bench:gen   # writes fixtures/generated/trivy-600mb.json (gitignored)
pnpm bench:parse                     # node --max-old-space-size=150 … parse-benchmark.js
pnpm bench:naive                     # the forbidden JSON.parse(readFile) version, for contrast
```

| Report                                     | Heap limit | Result                    | Peak heapUsed | Peak RSS | Throughput          |
| ------------------------------------------ | ---------- | ------------------------- | ------------- | -------- | ------------------- |
| 583 MB (335k findings, 6,700 critical)     | 150 MB     | ✅                        | 36 MB         | 77 MB    | ~51 MB/s            |
| 2,054 MB (1.18M findings, 23,600 critical) | 150 MB     | ✅                        | 40 MB         | 78 MB    | ~51 MB/s            |
| 583 MB                                     | 32 MB      | ✅                        | 24 MB         | 75 MB    | ~28 MB/s (GC-bound) |
| 583 MB, naive `JSON.parse(readFile)`       | 150 MB     | ❌ heap OOM within 100 ms | n/a           | n/a      | n/a                 |

**Memory stays flat as file size grows** (3.5× more data, same footprint), which is the property the assignment
asks for.

## What actually drives peak memory

`stream-json` tokenizes each input chunk in one go and pushes every token of that chunk
downstream, even when the consumer is paused. So the peak scales with **read chunk size × pipeline
stages**, not with file size. With 64KB chunks the same run peaked at 97MB heap / 170MB RSS and failed
under a 48MB heap. With 16KB chunks (`DEFAULT_READ_CHUNK_BYTES`) it peaks at 36MB and runs under 32MB, with
no loss of throughput.

Two other choices keep allocations low:

- Heavy fields (`Description`, `References`, `CVSS`, …) are dropped at the token level by an `Ignore` filter,
  so they are never assembled into JS objects.
- Findings are picked one at a time (`Results.N.Vulnerabilities.M`), never as whole `Result` objects, because a
  single lockfile can contain tens of thousands of findings.
