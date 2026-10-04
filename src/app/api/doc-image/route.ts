import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '@/lib/config';
import { getDoc } from '@/lib/retrieval';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

/** The original image of a scanned/photographed document, for the reader. Only files listed in the index are served. */
export async function GET(req: Request) {
  const d = await getDoc(new URL(req.url).searchParams.get('id') ?? '');
  const type = d && TYPES[path.extname(d.doc.file).toLowerCase()];
  if (!d || !type) return new Response('not found', { status: 404 });
  return new Response(new Uint8Array(fs.readFileSync(path.join(DATA_DIR, d.doc.file))), { headers: { 'content-type': type } });
}
