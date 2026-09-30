import fs from 'node:fs';
import { env } from './config';
import { buildIndex, Chunk, DocMeta, INDEX_FILE, IndexFile, VECTORS_FILE } from './corpus';
import { embed } from './providers';

const STOP = new Set(
  'a an and are as at be by for from has have he her his i in is it its of on or she that the their them they this to was were what when where which who whom why will with did does do how about into than then there these those you your my me we our not no can could would should also after before over under between'.split(' ')
);

/** Crude English suffix stripping so "study", "studied" and "studies" meet. Non-Latin words pass through. */
function stem(w: string): string {
  if (!/^[a-z]+$/.test(w) || w.length <= 3) return w;
  if (w.endsWith('ies') || w.endsWith('ied')) w = w.slice(0, -3) + 'i';
  else if (w.endsWith('s') && !w.endsWith('ss') && w.length > 4) w = w.slice(0, -1);
  if (w.endsWith('ing') && w.length > 6) w = w.slice(0, -3);
  else if (w.endsWith('ed') && w.length > 5) w = w.slice(0, -2);
  if (w.endsWith('e') && w.length > 4) w = w.slice(0, -1);
  if (w.endsWith('y') && w.length > 3) w = w.slice(0, -1) + 'i';
  return w;
}

export function tokenize(s: string): string[] {
  const words = s.toLowerCase().normalize('NFC').match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  return words.filter((w) => w.length > 1 && !STOP.has(w)).map(stem);
}

interface Loaded {
  mtime: number;
  index: IndexFile;
  docById: Map<string, DocMeta>;
  tf: Map<string, number>[];
  len: number[];
  df: Map<string, number>;
  avgdl: number;
  vectors: Float32Array | null;
}

let loaded: Loaded | null = null;
let building: Promise<void> | null = null;

async function ensure(): Promise<Loaded> {
  if (!fs.existsSync(INDEX_FILE)) {
    // First boot: build a keyword index from the seed notes so the kiosk works immediately.
    building ??= buildIndex({ withEmbeddings: false }).then(() => undefined).finally(() => (building = null));
    await building;
  }
  const mtime = fs.statSync(INDEX_FILE).mtimeMs;
  if (loaded && loaded.mtime === mtime) return loaded;

  const index: IndexFile = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  const docById = new Map(index.docs.map((d) => [d.id, d]));
  const tf: Map<string, number>[] = [];
  const len: number[] = [];
  const df = new Map<string, number>();
  for (const c of index.chunks) {
    const title = docById.get(c.doc)?.title ?? '';
    const toks = tokenize(`${title} ${c.text}`);
    const m = new Map<string, number>();
    for (const t of toks) m.set(t, (m.get(t) ?? 0) + 1);
    for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    tf.push(m);
    len.push(toks.length);
  }
  const avgdl = len.reduce((a, b) => a + b, 0) / Math.max(1, len.length);

  let vectors: Float32Array | null = null;
  if (index.embedModel && index.dim && fs.existsSync(VECTORS_FILE)) {
    const buf = fs.readFileSync(VECTORS_FILE);
    const v = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    if (v.length === index.dim * index.chunks.length) vectors = v;
  }
  loaded = { mtime, index, docById, tf, len, df, avgdl, vectors };
  return loaded;
}

export interface Hit {
  n: number; // 1-based citation number [S n]
  chunk: Chunk;
  doc: DocMeta;
  bm25: number;
  cosine: number | null;
  score: number;
}

export interface SearchResult {
  hits: Hit[];
  topBm25: number;
  topCosine: number | null;
  usedVectors: boolean;
  found: boolean;
  ms: number;
}

export async function search(query: string, k = env.retrieval.topK): Promise<SearchResult> {
  const t0 = Date.now();
  const L = await ensure();
  const N = L.index.chunks.length;
  const q = [...new Set(tokenize(query))];
  const k1 = 1.4, b = 0.75;

  const bm = new Float64Array(N);
  for (const term of q) {
    const df = L.df.get(term);
    if (!df) continue;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    for (let i = 0; i < N; i++) {
      const f = L.tf[i].get(term);
      if (!f) continue;
      bm[i] += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * L.len[i]) / L.avgdl));
    }
  }

  let cos: Float64Array | null = null;
  if (L.vectors && L.index.embedModel) {
    try {
      const [qv] = await embed([query], 5000);
      const norm = Math.hypot(...qv) || 1;
      const dim = L.index.dim;
      cos = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        let s = 0;
        for (let d = 0; d < dim; d++) s += L.vectors[i * dim + d] * qv[d];
        cos[i] = s / norm;
      }
    } catch {
      cos = null; // embedder offline → keyword only
    }
  }

  let maxBm = 1e-9;
  for (let i = 0; i < N; i++) if (bm[i] > maxBm) maxBm = bm[i];
  const order = [...Array(N).keys()]
    .map((i) => ({ i, s: cos ? 0.45 * (bm[i] / maxBm) + 0.55 * Math.max(0, cos[i]) : bm[i] }))
    .sort((a, b) => b.s - a.s);

  // at most 2 passages per document so answers draw on varied sources
  const perDoc = new Map<string, number>();
  const hits: Hit[] = [];
  for (const { i, s } of order) {
    if (hits.length >= k) break;
    if (s <= 0) break;
    const c = L.index.chunks[i];
    const used = perDoc.get(c.doc) ?? 0;
    if (used >= 2) continue;
    perDoc.set(c.doc, used + 1);
    hits.push({ n: hits.length + 1, chunk: c, doc: L.docById.get(c.doc)!, bm25: bm[i], cosine: cos ? cos[i] : null, score: s });
  }

  const topBm25 = hits.length ? Math.max(...hits.map((h) => h.bm25)) : 0;
  const topCosine = cos && hits.length ? Math.max(...hits.map((h) => h.cosine ?? 0)) : null;
  const found = topBm25 >= env.retrieval.minScore || (topCosine !== null && topCosine >= env.retrieval.minVector);
  return { hits, topBm25, topCosine, usedVectors: !!cos, found, ms: Date.now() - t0 };
}

export async function getDoc(id: string) {
  const L = await ensure();
  const doc = L.docById.get(id);
  if (!doc) return null;
  return { doc, chunks: L.index.chunks.filter((c) => c.doc === id) };
}

export async function indexStats() {
  const L = await ensure();
  return {
    documents: L.index.docs.length,
    passages: L.index.chunks.length,
    vocabulary: L.df.size,
    embedModel: L.index.embedModel,
    vectors: !!L.vectors,
    builtAt: L.index.builtAt,
    docs: L.index.docs.map((d) => ({ id: d.id, title: d.title, type: d.type, date: d.date, pages: d.pages })),
  };
}
