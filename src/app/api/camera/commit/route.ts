import fs from 'node:fs';
import path from 'node:path';
import { adminAllowed, forbidden } from '@/lib/admin';
import { DATA_DIR, env } from '@/lib/config';
import { buildIndex } from '@/lib/corpus';
import { DEMO } from '@/lib/demo';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Adds the last capture to the archive (data/docs) and re-indexes, so the page is searchable and citable. */
export async function POST(req: Request) {
  if (!adminAllowed(req)) return forbidden();
  const { id, title } = await req.json().catch(() => ({}));
  const src = path.join(DATA_DIR, 'scans', `${String(id).replace(/[^\dA-Za-z-]/g, '')}.jpg`);
  if (!id || !fs.existsSync(src)) return Response.json({ error: 'capture not found — take the picture again' }, { status: 404 });
  const name = String(title || `Scanned page ${id}`).replace(/[^\p{L}\p{N} ,.'()-]+/gu, ' ').trim().slice(0, 80) || `Scanned page ${id}`;
  let file = `${name}.jpg`;
  for (let n = 2; fs.existsSync(path.join(DATA_DIR, 'docs', file)); n++) file = `${name} ${n}.jpg`;
  fs.mkdirSync(path.join(DATA_DIR, 'docs'), { recursive: true });
  fs.renameSync(src, path.join(DATA_DIR, 'docs', file));
  // The scripted demo runs without models, so it re-indexes keywords only (re-index with embeddings afterwards for live mode).
  const index = await buildIndex({ withEmbeddings: !DEMO && !!env.local.embedModel });
  const doc = index.docs.find((d) => d.file === `docs/${file}`);
  return Response.json({ doc: doc ?? null, passages: index.chunks.filter((c) => c.doc === doc?.id).length });
}
