import { env, isLang } from '@/lib/config';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Proxies recorded audio to an OpenAI-compatible transcription server (local faster-whisper or an online API). */
export async function POST(req: Request) {
  if (!env.voice.sttUrl) return Response.json({ error: 'Speech-to-text is not configured (STT_URL)' }, { status: 404 });
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof Blob)) return Response.json({ error: 'file required' }, { status: 400 });
  const lang = form.get('lang');
  const out = new FormData();
  out.append('file', file, 'speech.webm');
  out.append('model', env.voice.sttModel);
  if (isLang(lang)) out.append('language', lang);
  const t0 = Date.now();
  try {
    const res = await fetch(`${env.voice.sttUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: env.voice.sttKey ? { authorization: `Bearer ${env.voice.sttKey}` } : {},
      body: out,
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return Response.json({ error: `STT HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` }, { status: 502 });
    const j = await res.json();
    return Response.json({ text: String(j.text ?? '').trim(), ms: Date.now() - t0 });
  } catch (e) {
    return Response.json({ error: `STT unreachable: ${(e as Error).message}` }, { status: 502 });
  }
}
