# Bake-off harness

Compares the **TypeScript** and **Rust** backends head-to-head, fairly.

```bash
bash bench/run_all.sh          # N=2000 C=50 defaults; override: N=5000 C=100 bash bench/run_all.sh
```

For each backend it: starts it as a standalone server on the same host → **conformance gate**
(`conformance.ts`: the backend's JSON must match the TypeScript reference, semantically) →
**load test** (`load.ts`: latency p50/p95/p99 + throughput) on identical endpoints in fixture
mode. A backend's numbers only count if conformance passes.

## Files
- `conformance.ts` — semantic JSON equality vs the TS data layer (ignores volatile `generatedAt`).
- `load.ts` — N requests at concurrency C; reports rps + p50/p95/p99.
- `run_all.sh` — orchestrates both backends (TS `src/api_server.ts` :8788, Rust `pp-server` :8787).

## Honest reading of the results
- **Compare only after conformance passes** — a fast wrong answer is disqualified.
- The numbers are **indicative**, not publishable: single laptop, `undici` fetch as the driver,
  small N. They compare backends *relative to each other*, not absolute capacity.
- **Server architecture dominated the first run, not the language.** With `Connection: close` +
  thread-per-request the Rust server looked slow; adding **HTTP keep-alive** brought it level
  with / ahead of Node. Lesson: measure the same architecture, or you measure the wrong thing.
- **The deepest finding matches `CACHING_ARCHITECTURE.md`:** for this read-heavy, cache-frontable
  workload the language gap is modest. In production the **CDN + L0 static + immutable caching**
  absorb almost all reads, so both backends would serve most traffic identically. The bake-off's
  real value is therefore **developer experience / maintainability**, not a dramatic prod-latency
  delta — pick the one you'd rather own.
