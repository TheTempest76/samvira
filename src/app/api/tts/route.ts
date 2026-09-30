import { env } from '@/lib/config';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Proxies text to an OpenAI-compatible speech server; the kiosk falls back to the browser voice when this 404s. */
export async function POST(req: Request) {
  if (!env.voice.ttsUrl) return Response.json({ error: 'TTS not configured' }, { status: 404 });
  const { text } = await req.json().catch(() => ({ text: '' }));
  const input = String(text ?? '').replace(/\[S\d+\]/g, '').slice(0, 1500);
  if (!input.trim()) return Response.json({ error: 'text required' }, { status: 400 });
  try {
    const res = await fetch(`${env.voice.ttsUrl}/audio/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(env.voice.ttsKey ? { authorization: `Bearer ${env.voice.ttsKey}` } : {}) },
      body: JSON.stringify({ model: env.voice.ttsModel || undefined, voice: env.voice.ttsVoice || undefined, input, response_format: 'mp3' }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok || !res.body) return Response.json({ error: `TTS HTTP ${res.status}` }, { status: 502 });
    return new Response(res.body, { headers: { 'content-type': res.headers.get('content-type') || 'audio/mpeg' } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
