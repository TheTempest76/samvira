import { env, isLang } from '@/lib/config';
import { cachedAudio, ttsInput } from '@/lib/demo';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Proxies text to an OpenAI-compatible speech server (on the Jetson: voice/tts_server.py, Piper).
 * The voice is picked by kiosk language unless TTS_VOICE pins one. The kiosk falls back to the browser voice when this 404s.
 */
export async function POST(req: Request) {
  const { text, lang } = await req.json().catch(() => ({ text: '' }));
  const input = ttsInput(text);
  if (!input.trim()) return Response.json({ error: 'text required' }, { status: 400 });
  // Pre-rendered lines (scripted demo answers, refusals) play instantly with no TTS server running.
  const cached = cachedAudio(isLang(lang) ? lang : 'en', input);
  if (cached) return new Response(new Uint8Array(cached), { headers: { 'content-type': 'audio/wav' } });
  if (!env.voice.ttsUrl) return Response.json({ error: 'TTS not configured' }, { status: 404 });
  try {
    const res = await fetch(`${env.voice.ttsUrl}/audio/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(env.voice.ttsKey ? { authorization: `Bearer ${env.voice.ttsKey}` } : {}) },
      body: JSON.stringify({
        model: env.voice.ttsModel || undefined,
        voice: env.voice.ttsVoice || (isLang(lang) ? lang : 'en'),
        input,
        response_format: 'mp3',
      }),
      signal: AbortSignal.timeout(30000),
    });
    // 404 = no voice for this language; the kiosk uses the browser voice instead.
    if (!res.ok || !res.body) return Response.json({ error: `TTS HTTP ${res.status}` }, { status: res.status === 404 ? 404 : 502 });
    return new Response(res.body, { headers: { 'content-type': res.headers.get('content-type') || 'audio/mpeg' } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
