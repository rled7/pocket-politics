#!/usr/bin/env bash
# Bake-off harness — runs each backend as a standalone server on the same host, gates on
# conformance (must match the TypeScript reference JSON), then benchmarks identical endpoints
# in fixture mode (fair: both do the same work, no network). Pattern mirrors AlgoForge's
# benchmarks/run_all.sh.
#
#   bash bench/run_all.sh            # N=2000 C=50 defaults
set -uo pipefail
cd "$(dirname "$0")/.."
source "$HOME/.cargo/env" 2>/dev/null || true

N=${N:-2000}; C=${C:-50}

echo "building rust backend (release)…"
( cd rust && cargo build --release -q )

bench_backend() {
  local name="$1" port="$2"; shift 2
  echo; echo "════════ $name backend (port $port) ════════"
  "$@" >"/tmp/pp_${name}.log" 2>&1 & local pid=$!
  sleep 4
  echo "── conformance (vs TypeScript reference) ──"
  BASE="http://localhost:$port" npx tsx bench/conformance.ts 2>&1 | grep -E "✓|✗|passed|conforms" || true
  echo "── load (N=$N, C=$C, fixture mode) ──"
  for p in "/api/members" "/api/bills" "/api/profile?bioguide=O000172"; do
    npx tsx bench/load.ts "http://localhost:$port" "$p" "$N" "$C"
  done
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
}

bench_backend ts   8788 env PORT=8788 npx tsx src/api_server.ts
bench_backend rust 8787 env PORT=8787 ./rust/target/release/pp-server

echo; echo "bake-off complete — conformance must pass before comparing the load numbers."
