import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DATA_DIR, env } from './config';
import { embed } from './providers';

const run = promisify(execFile);

export interface DocMeta {
  id: string;
  title: string;
  type: string;
  date?: string;
  place?: string;
  file: string;
  pages?: number;
}
export interface Chunk {
  id: string; // `${doc}#${n}`
  doc: string;
  page?: number;
  text: string;
}
export interface IndexFile {
  version: 1;
  builtAt: string;
  embedModel: string | null;
  dim: number;
  docs: DocMeta[];
  chunks: Chunk[];
}

export const INDEX_FILE = path.join(DATA_DIR, 'index.json');
export const VECTORS_FILE = path.join(DATA_DIR, 'vectors.f32');

const slug = (s: string) =>
  s.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'doc';

function parseFrontMatter(raw: string) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {} as Record<string, string>, body: raw };
  const meta: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: m[2] };
}

/** Splits text into ~target-sized chunks on paragraph, then sentence, boundaries. */
export function chunkText(text: string, target = 900): string[] {
  const paras = text
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim())
    .filter((p) => p.length > 0);
  const pieces: string[] = [];
  for (const p of paras) {
    if (p.length <= target * 1.4) { pieces.push(p); continue; }
    const sentences = p.match(/[^.!?।]+[.!?।]+["')\]]*\s*|[^.!?।]+$/g) ?? [p];
    let cur = '';
    for (const s of sentences) {
      if (cur && (cur + s).length > target) { pieces.push(cur.trim()); cur = ''; }
      cur += s;
    }
    if (cur.trim()) pieces.push(cur.trim());
  }
  // merge very small neighbours so each chunk carries enough context
  const out: string[] = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    if (last && (last.length < target * 0.35 || p.length < 120) && (last + ' ' + p).length <= target * 1.4) out[out.length - 1] = last + '\n\n' + p;
    else out.push(p);
  }
  return out;
}

async function pdfPages(file: string): Promise<string[]> {
  const { stdout } = await run('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { maxBuffer: 512 * 1024 * 1024 });
  const pages = stdout.split('\f');
  if (pages.length > 1 && !pages[pages.length - 1].trim()) pages.pop(); // trailing form feed
  return pages;
}

export type Progress = (msg: string) => void;

export async function buildIndex(opts: { withEmbeddings?: boolean; onProgress?: Progress } = {}): Promise<IndexFile> {
  const log = opts.onProgress ?? (() => {});
  const docs: DocMeta[] = [];
  const chunks: Chunk[] = [];
  const used = new Set<string>();
  const uniq = (id: string) => {
    let u = id, n = 2;
    while (used.has(u)) u = `${id}-${n++}`;
    used.add(u);
    return u;
  };

  // 1. curated seed notes (markdown + front matter)
  const seedDir = path.join(DATA_DIR, 'seed');
  for (const f of fs.existsSync(seedDir) ? fs.readdirSync(seedDir).sort() : []) {
    if (!/\.(md|txt)$/i.test(f)) continue;
    const { meta, body } = parseFrontMatter(fs.readFileSync(path.join(seedDir, f), 'utf8'));
    const id = uniq(meta.id || slug(f));
    docs.push({ id, title: meta.title || f, type: meta.type || 'Note', date: meta.date, place: meta.place, file: `seed/${f}` });
    chunkText(body).forEach((t, i) => chunks.push({ id: `${id}#${i}`, doc: id, text: t }));
  }
  log(`seed: ${docs.length} notes`);

  // 2. archive files dropped into data/docs (pdf / txt / md)
  const docsDir = path.join(DATA_DIR, 'docs');
  for (const f of fs.existsSync(docsDir) ? fs.readdirSync(docsDir).sort() : []) {
    const full = path.join(docsDir, f);
    if (/^readme/i.test(f) || !fs.statSync(full).isFile()) continue;
    const title = f.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    try {
      if (/\.pdf$/i.test(f)) {
        log(`extracting ${f} …`);
        const pages = await pdfPages(full);
        const id = uniq(slug(f));
        docs.push({ id, title, type: 'Archive PDF', file: `docs/${f}`, pages: pages.length });
        let n = 0;
        pages.forEach((pg, pi) => {
          for (const t of chunkText(pg)) if (t.length > 40) chunks.push({ id: `${id}#${n++}`, doc: id, page: pi + 1, text: t });
        });
        log(`${f}: ${pages.length} pages, ${n} passages`);
      } else if (/\.(txt|md)$/i.test(f)) {
        const { meta, body } = parseFrontMatter(fs.readFileSync(full, 'utf8'));
        const id = uniq(meta.id || slug(f));
        docs.push({ id, title: meta.title || title, type: meta.type || 'Archive text', date: meta.date, place: meta.place, file: `docs/${f}` });
        chunkText(body).forEach((t, i) => chunks.push({ id: `${id}#${i}`, doc: id, text: t }));
      }
    } catch (e) {
      log(`skipped ${f}: ${(e as Error).message}`);
    }
  }

  // 3. optional embeddings (multilingual retrieval)
  let embedModel: string | null = null;
  let dim = 0;
  if (opts.withEmbeddings !== false && env.local.embedModel) {
    try {
      const vecs: number[][] = [];
      const B = 16;
      for (let i = 0; i < chunks.length; i += B) {
        const batch = chunks.slice(i, i + B).map((c) => `${docs.find((d) => d.id === c.doc)?.title ?? ''}\n${c.text}`);
        vecs.push(...(await embed(batch, 120000)));
        if (i % (B * 10) === 0) log(`embedding ${Math.min(i + B, chunks.length)}/${chunks.length}`);
      }
      dim = vecs[0]?.length ?? 0;
      const buf = new Float32Array(vecs.length * dim);
      vecs.forEach((v, i) => {
        const norm = Math.hypot(...v) || 1;
        for (let k = 0; k < dim; k++) buf[i * dim + k] = v[k] / norm;
      });
      fs.writeFileSync(VECTORS_FILE, Buffer.from(buf.buffer));
      embedModel = env.local.embedModel;
      log(`embeddings: ${vecs.length} × ${dim} (${embedModel})`);
    } catch (e) {
      log(`embeddings skipped (${(e as Error).message}) — keyword search only`);
      if (fs.existsSync(VECTORS_FILE)) fs.rmSync(VECTORS_FILE);
    }
  } else if (fs.existsSync(VECTORS_FILE)) {
    fs.rmSync(VECTORS_FILE);
  }

  const index: IndexFile = { version: 1, builtAt: new Date().toISOString(), embedModel, dim, docs, chunks };
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index));
  log(`index written: ${docs.length} documents, ${chunks.length} passages`);
  return index;
}
