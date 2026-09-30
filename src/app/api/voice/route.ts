import { env } from '@/lib/config';
export const dynamic = 'force-dynamic';
export async function GET() {
  return Response.json({ stt: !!env.voice.sttUrl, tts: !!env.voice.ttsUrl });
}
