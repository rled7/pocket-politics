/// <reference types="@cloudflare/workers-types" />

// GET  /api/comments?bill=118-hr-1   → list comments for a bill
// POST /api/comments  {bill, author, text}  → add a comment
// Stored in KV (POCKETPOL_KV). Comments are self-attested USER OPINION, separate from the
// official record. Registered-voter verification is future work (needs an identity provider).
import { getStore, type KVLike } from '../../src/store.ts';
import { getComments, addComment, validBillId } from '../../src/comments.ts';

const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const onRequestGet: PagesFunction<{ POCKETPOL_KV?: KVLike }> = async (context) => {
  const bill = new URL(context.request.url).searchParams.get('bill') ?? '';
  if (!validBillId(bill)) return json(400, { error: 'invalid bill id' });
  return json(200, { comments: await getComments(getStore(context.env), bill) });
};

export const onRequestPost: PagesFunction<{ POCKETPOL_KV?: KVLike }> = async (context) => {
  let payload: { bill?: string; author?: string; text?: string };
  try { payload = await context.request.json(); } catch { return json(400, { error: 'invalid JSON' }); }
  const bill = String(payload.bill ?? '');
  if (!validBillId(bill)) return json(400, { error: 'invalid bill id' });
  try {
    const comments = await addComment(getStore(context.env), bill, payload.author ?? '', payload.text ?? '');
    return json(200, { comments });
  } catch (e) {
    return json(400, { error: e instanceof Error ? e.message : 'bad request' });
  }
};
