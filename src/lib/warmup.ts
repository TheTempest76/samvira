import { env } from './config';
import { embed } from './providers';

/**
 * Loads the chat model, then the embedding model, into Ollama and keeps them there. Safe to call repeatedly.
 * Also runs one throwaway transcription so Whisper is ready.
 * Order matters on the Orin Nano: the chat model needs GPU memory, which is easiest to get before anything else loads.
 */
export async function warmUp() {
  const t0 = Date.now();
  const done: string[] = [];
  try {
    // A generate request with no prompt just loads the model.
    const { getSettings } = await import('./settings');
    const model = getSettings().localChatModel;
    const res = await fetch(`${env.local.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, keep_alive: env.local.keepAlive }),
      signal: AbortSignal.timeout(180000),
    });
    if (res.ok) done.push(model);
    else console.warn(`[warm-up] ${model}: HTTP ${res.status}`);
  } catch (e) {
    console.warn(`[warm-up] chat model: ${(e as Error).message}`);
  }
  if (env.local.embedModel) {
    try {
      await embed(['warm-up'], 180000);
      done.push(env.local.embedModel);
    } catch (e) {
      console.warn(`[warm-up] ${env.local.embedModel}: ${(e as Error).message}`);
    }
  }
  if (env.voice.sttUrl) {
    // Whisper's first transcription after a start is slow (~15 s of GPU kernel set-up); do it now with a second of silence.
    try {
      const fd = new FormData();
      fd.append('file', new Blob([silentWav(1)], { type: 'audio/wav' }), 'warm-up.wav');
      fd.append('model', env.voice.sttModel);
      fd.append('language', 'en');
      const res = await fetch(`${env.voice.sttUrl}/audio/transcriptions`, { method: 'POST', body: fd, signal: AbortSignal.timeout(120000) });
      if (res.ok) done.push('speech-to-text');
    } catch (e) {
      console.warn(`[warm-up] speech-to-text: ${(e as Error).message}`);
    }
  }
  if (done.length) console.log(`[warm-up] loaded ${done.join(', ')} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

/** A mono 16 kHz 16-bit WAV of silence. */
function silentWav(seconds: number) {
  const n = 16000 * seconds;
  const b = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o: number, t: string) => [...t].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, 16000, true); b.setUint32(28, 32000, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true);
  str(36, 'data'); b.setUint32(40, n * 2, true);
  return b.buffer;
}
