import { env } from '@/lib/config';
import { DEMO, DEMO_SCRIPT } from '@/lib/demo';
export const dynamic = 'force-dynamic';
export async function GET() {
  return Response.json({
    stt: !!env.voice.sttUrl || DEMO,
    tts: !!env.voice.ttsUrl,
    // Scripted demo: the mic plays these questions in turn instead of recording.
    demo: DEMO ? DEMO_SCRIPT : null,
  });
}
