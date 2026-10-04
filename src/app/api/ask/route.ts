import { adminAllowed } from '@/lib/admin';
import { DEMO, findDemoAnswer } from '@/lib/demo';
import { env, isLang, Lang } from '@/lib/config';
import { recordQuery, QueryRecord } from '@/lib/metrics';
import {
  buildMessages,
  citedNumbers,
  extractiveAnswer,
  REFUSAL_TEXT,
  REFUSAL_TOKEN,
  sourceLabel,
  translateQueryMessages,
} from '@/lib/prompt';
import { completeChat, onlineConfigured, ProviderError, streamChat, Target } from '@/lib/providers';
import { getChunks, Hit, search } from '@/lib/retrieval';
import { getSettings } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Streams an answer as NDJSON events:
 *   {type:"meta", sources, retrieval}
 *   {type:"status", text}            – e.g. "Local model unavailable, trying online…"
 *   {type:"delta", text}
 *   {type:"done", verdict, cited, answeredBy, model, latencyMs, firstTokenMs}
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const question = String(body.question ?? '').trim().slice(0, 500);
  const lang: Lang = isLang(body.lang) ? body.lang : 'en';
  if (!question) return Response.json({ error: 'question required' }, { status: 400 });

  const settings = getSettings();
  const t0 = Date.now();
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: object) => controller.enqueue(enc.encode(JSON.stringify(o) + '\n'));
      const fallbacks: string[] = [];
      // Operators can force one engine (used by the dashboard's side-by-side benchmark).
      const force = adminAllowed(req) && ['local', 'online', 'extractive'].includes(body.force) ? (body.force as string) : null;
      // Scripted demo: unscripted questions get archive passages only, so no model is ever loaded.
      const mode = force ?? (DEMO ? 'extractive' : settings.mode);
      const targets: Target[] =
        mode === 'auto' ? ['local', 'online'] : mode === 'local' ? ['local'] : mode === 'online' ? ['online'] : [];
      const modelFor = (t: Target) => (t === 'local' ? settings.localChatModel : settings.onlineChatModel);
      const usable = (t: Target) => t === 'local' || (onlineConfigured() && !!settings.onlineChatModel);

      const rec: QueryRecord = {
        ts: t0, question: question.slice(0, 120), lang, mode: force ? `bench:${force}` : settings.mode, answeredBy: 'refused', model: null,
        latencyMs: 0, firstTokenMs: null, retrievalMs: 0, sources: 0, cited: 0, verdict: 'refused', fallbacks, usedVectors: false,
      };

      try {
        // ── 0. Scripted demo answer ──
        const scripted = DEMO && !force ? findDemoAnswer(question) : null;
        if (scripted) {
          const hits = await getChunks(scripted.sources);
          send({
            type: 'meta',
            sources: hits.map((h) => ({
              n: h.n, doc: h.doc.id, title: h.doc.title, type: h.doc.type, date: h.doc.date ?? null,
              page: h.chunk.page ?? null, label: sourceLabel(h), chunk: h.chunk.id, snippet: h.chunk.text, score: 1,
            })),
            retrieval: { ms: 12, found: true, usedVectors: false, topBm25: 0 },
          });
          await sleep(700, req.signal);
          // Stream a couple of words at a time, like a model writing.
          const words = scripted.answer.match(/\S+\s*/g) ?? [];
          rec.firstTokenMs = Date.now() - t0;
          for (let i = 0; i < words.length; i += 2) {
            if (req.signal.aborted) return;
            send({ type: 'delta', text: words.slice(i, i + 2).join('') });
            await sleep(55, req.signal);
          }
          const cited = citedNumbers(scripted.answer, hits.length);
          Object.assign(rec, { answeredBy: 'local', model: 'scripted demo', verdict: 'grounded', cited: cited.length, sources: hits.length, latencyMs: Date.now() - t0 });
          send({ type: 'done', verdict: 'grounded', cited, answeredBy: 'local', model: null, latencyMs: rec.latencyMs, firstTokenMs: rec.firstTokenMs, fallbacks });
          recordQuery(rec);
          return;
        }

        // ── 1. Retrieve ──
        let result = await search(question);
        // Non-Latin question that found nothing (no multilingual vectors, or a misspelling — common in spoken
        // questions, e.g. "समजोता" for "समझौता") → ask a model for English keywords and search again.
        if ((!result.usedVectors || !result.found) && /[^\u0000-ɏ\s\d\p{P}]/u.test(question) && targets.length) {
          for (const t of targets.filter(usable)) {
            try {
              send({ type: 'status', text: 'Translating your question for the archive search…' });
              const q2 = (await completeChat(t, translateQueryMessages(question), modelFor(t))).trim().slice(0, 200);
              if (q2) result = await search(q2);
              break;
            } catch {
              /* try next */
            }
          }
        }
        rec.retrievalMs = result.ms;
        rec.usedVectors = result.usedVectors;
        rec.sources = result.hits.length;
        const hits = result.hits;
        send({
          type: 'meta',
          sources: hits.map((h: Hit) => ({
            n: h.n, doc: h.doc.id, title: h.doc.title, type: h.doc.type, date: h.doc.date ?? null,
            page: h.chunk.page ?? null, label: sourceLabel(h), chunk: h.chunk.id,
            snippet: h.chunk.text.length > 420 ? h.chunk.text.slice(0, 420) + '…' : h.chunk.text,
            score: Number(h.score.toFixed(3)),
          })),
          retrieval: { ms: result.ms, found: result.found, usedVectors: result.usedVectors, topBm25: Number(result.topBm25.toFixed(2)) },
        });

        // ── 2. Nothing relevant → refuse before calling any model ──
        if (!result.found) {
          send({ type: 'delta', text: REFUSAL_TEXT[lang] });
          rec.latencyMs = Date.now() - t0;
          send({ type: 'done', verdict: 'refused', cited: [], answeredBy: 'refused', model: null, latencyMs: rec.latencyMs, firstTokenMs: null, fallbacks });
          recordQuery(rec);
          return;
        }

        // ── 3. Generate with the first model that answers ──
        let answer = '';
        let firstTokenMs: number | null = null;
        let answeredBy: QueryRecord['answeredBy'] = 'extractive';
        let model: string | null = null;

        for (const t of targets) {
          if (!usable(t)) {
            fallbacks.push(`${t}: not configured`);
            continue;
          }
          const m = modelFor(t);
          let started = false;
          let held = true; // hold output until we know it isn't a bare refusal token
          let refusedByModel = false;
          try {
            send({ type: 'status', text: t === 'local' ? `Asking on-device model (${m})…` : `Asking online model (${m})…` });
            for await (const piece of streamChat(t, buildMessages(question, hits, lang), m, req.signal)) {
              if (firstTokenMs === null) firstTokenMs = Date.now() - t0;
              started = true;
              answer += piece;
              if (held) {
                const head = answer.trimStart();
                if (head.length < REFUSAL_TOKEN.length && REFUSAL_TOKEN.startsWith(head)) continue;
                if (head.startsWith(REFUSAL_TOKEN)) { refusedByModel = true; break; }
                held = false;
                send({ type: 'delta', text: answer });
                continue;
              }
              send({ type: 'delta', text: piece });
            }
            if (held && !refusedByModel) {
              const head = answer.trim();
              if (!head || head.startsWith(REFUSAL_TOKEN)) refusedByModel = true;
              else send({ type: 'delta', text: answer });
            }
            answeredBy = t;
            model = m;
            if (refusedByModel) {
              answer = '';
              send({ type: 'delta', text: REFUSAL_TEXT[lang] });
            }
            break;
          } catch (e) {
            const msg = e instanceof ProviderError || e instanceof Error ? e.message : String(e);
            fallbacks.push(`${t}: ${msg}`);
            if (started) {
              send({ type: 'status', text: 'The model stopped mid-answer.' });
              answeredBy = t;
              model = m;
              break;
            }
            send({ type: 'status', text: `${t === 'local' ? 'On-device' : 'Online'} model unavailable — ${targets.indexOf(t) < targets.length - 1 ? 'trying the next one…' : 'showing archive passages instead.'}` });
          }
        }

        // ── 4. No model answered (or extractive mode) → quote the archive directly ──
        if (answeredBy === 'extractive') {
          answer = extractiveAnswer(hits);
          if (lang !== 'en') send({ type: 'status', text: 'Showing original archive text (English).' });
          send({ type: 'delta', text: answer });
        }

        // ── 5. Grounding check (cite-or-refuse) ──
        const cited = citedNumbers(answer, hits.length);
        let verdict: QueryRecord['verdict'];
        if (answeredBy === 'extractive') verdict = 'extractive';
        else if (!answer) verdict = 'refused';
        else if (cited.length === 0 && settings.requireCitations) verdict = 'uncited';
        else verdict = 'grounded';

        rec.answeredBy = answeredBy;
        rec.model = model;
        rec.firstTokenMs = firstTokenMs;
        rec.cited = cited.length;
        rec.verdict = verdict;
        rec.latencyMs = Date.now() - t0;
        send({
          type: 'done', verdict, cited, answeredBy, model, latencyMs: rec.latencyMs, firstTokenMs, fallbacks,
          refusalText: verdict === 'uncited' ? REFUSAL_TEXT[lang] : undefined,
        });
        recordQuery(rec);
      } catch (e) {
        rec.verdict = 'error';
        rec.latencyMs = Date.now() - t0;
        recordQuery(rec);
        send({ type: 'error', text: (e as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  });
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((r) => { const t = setTimeout(r, ms); signal.addEventListener('abort', () => { clearTimeout(t); r(); }); });

export async function GET() {
  return Response.json({ usage: 'POST {question, lang}', topK: env.retrieval.topK });
}
