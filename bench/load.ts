/**
 * Tiny load driver — fires N requests at concurrency C against one URL and reports latency
 * percentiles + throughput. No external tools (wrk/ab) needed. Numbers are indicative
 * (single-host, undici keep-alive), used to compare backends apples-to-apples.
 *
 *   npx tsx bench/load.ts <base> <path> [N=2000] [C=50]
 */
const [, , base, path, nArg, cArg] = process.argv;
if (!base || !path) { console.error("usage: load.ts <base> <path> [N] [C]"); process.exit(2); }
const N = Number(nArg ?? 2000);
const C = Number(cArg ?? 50);
const url = base + path;

const lat: number[] = [];
let started = 0, errors = 0;

async function worker() {
  while (started < N) {
    started++;
    const s = performance.now();
    try {
      const r = await fetch(url);
      await r.arrayBuffer();
      if (r.status >= 500) errors++;
    } catch { errors++; }
    lat.push(performance.now() - s);
  }
}

const t0 = performance.now();
await Promise.all(Array.from({ length: C }, worker));
const secs = (performance.now() - t0) / 1000;

lat.sort((a, b) => a - b);
const pct = (p: number) => lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))];
const f = (x: number) => x.toFixed(2);
console.log(
  `  ${path.padEnd(32)} rps=${(N / secs).toFixed(0).padStart(6)}  ` +
  `p50=${f(pct(50))}ms  p95=${f(pct(95))}ms  p99=${f(pct(99))}ms  err=${errors}`,
);
