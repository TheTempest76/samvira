import { search } from '@/lib/retrieval';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';
  if (!q) return Response.json({ hits: [] });
  const r = await search(q, 8);
  return Response.json({
    ms: r.ms,
    usedVectors: r.usedVectors,
    hits: r.hits.map((h) => ({ doc: h.doc.id, title: h.doc.title, date: h.doc.date, page: h.chunk.page, chunk: h.chunk.id, text: h.chunk.text, score: h.score })),
  });
}
