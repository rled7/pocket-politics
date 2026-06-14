/**
 * Build / release version — the human-facing app version, distinct from `dataVersion` (which
 * stamps the cached DATA, not the code). Bump this with each release and add a matching entry to
 * CHANGELOG.md. `build` tracks the commit count at release time, so it's a real, monotonic number.
 *
 * Surfaced at /api/version and shown in the page footer so every screen says which build it is.
 */
export const VERSION = "0.11.0";
export const BUILD = 52;
export const BUILD_TAG = `v${VERSION} · build ${BUILD}`;

export function buildInfo(): { name: string; version: string; build: number; tag: string } {
  return { name: "Pocket Politics", version: VERSION, build: BUILD, tag: BUILD_TAG };
}
