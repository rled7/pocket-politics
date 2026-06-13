/// <reference types="@cloudflare/workers-types" />

// GET /api/latest — the version pointer. Tiny, short-lived, SWR. Clients read this, then
// fetch immutable payloads at /api/v/{dataVersion}/... (CACHING_ARCHITECTURE.md §4).
import { dataVersion } from '../../src/version.ts';
import { jsonPointer } from '../../src/http.ts';

export const onRequestGet: PagesFunction = async () => {
  return jsonPointer({ dataVersion: dataVersion() });
};
