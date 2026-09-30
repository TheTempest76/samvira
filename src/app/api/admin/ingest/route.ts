import { adminAllowed, forbidden } from '@/lib/admin';
import { buildIndex } from '@/lib/corpus';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let running = false;

/** Rebuilds the search index from data/seed + data/docs, streaming progress lines. */
export async function POST(req: Request) {
  if (!adminAllowed(req)) return forbidden();
  if (running) return Response.json({ error: 'indexing already running' }, { status: 409 });
  const { embeddings = true } = await req.json().catch(() => ({}));
  running = true;
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(c) {
      const say = (m: string) => c.enqueue(enc.encode(m + '\n'));
      try {
        await buildIndex({ withEmbeddings: embeddings, onProgress: say });
        say('DONE');
      } catch (e) {
        say(`ERROR ${(e as Error).message}`);
      } finally {
        running = false;
        c.close();
      }
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}
