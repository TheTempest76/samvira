import fs from 'node:fs';
import path from 'node:path';
import { adminAllowed, forbidden } from '@/lib/admin';
import { env, Lang } from '@/lib/config';
import { audioKey, DEMO_ANSWERS, DEMO_AUDIO_DIR, ttsInput } from '@/lib/demo';
import { REFUSAL_TEXT } from '@/lib/prompt';
import { speakable, splitSentences } from '@/lib/sentences';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Renders every line the scripted demo speaks into data/demo-audio, using the TTS server (voice/tts_server.py).
 * Run once after editing src/lib/demo.ts; afterwards the demo needs no TTS server.
 */
export async function POST(req: Request) {
  if (!adminAllowed(req)) return forbidden();
  if (!env.voice.ttsUrl) return Response.json({ error: 'TTS_URL not set' }, { status: 400 });
  fs.mkdirSync(DEMO_AUDIO_DIR, { recursive: true });

  // [cache voice, Piper voice, text]
  const jobs: [string, string, string][] = [];
  const lines = (lang: Lang, text: string) =>
    splitSentences(text).forEach((s) => jobs.push([lang, lang, ttsInput(speakable(s.text))]));
  for (const a of DEMO_ANSWERS) lines(a.lang, a.answer);
  for (const l of ['en', 'hi', 'mr'] as Lang[]) lines(l, REFUSAL_TEXT[l]);

  const report: string[] = [];
  for (const [key, voice, input] of jobs) {
    const res = await fetch(`${env.voice.ttsUrl}/audio/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ voice, input }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) { report.push(`FAILED ${voice}: ${input.slice(0, 40)} (HTTP ${res.status})`); continue; }
    fs.writeFileSync(path.join(DEMO_AUDIO_DIR, `${audioKey(key, input)}.wav`), Buffer.from(await res.arrayBuffer()));
    report.push(`ok ${voice}: ${input.slice(0, 60)}`);
  }
  return Response.json({ rendered: report.filter((r) => r.startsWith('ok')).length, of: jobs.length, report });
}
