import { env } from '@/lib/config';
import { localStatus, onlineStatus } from '@/lib/providers';
import { indexStats } from '@/lib/retrieval';
import { getSettings } from '@/lib/settings';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const [local, online, index] = await Promise.all([localStatus(), onlineStatus(), indexStats()]);
  return Response.json({
    settings: getSettings(),
    local: { ...local, baseUrl: env.local.baseUrl, embedModel: env.local.embedModel || null },
    online: { ...online, provider: env.online.provider, baseUrl: env.online.baseUrl },
    voice: { stt: !!env.voice.sttUrl, tts: !!env.voice.ttsUrl },
    index,
    adminPin: !!process.env.ADMIN_PIN,
  });
}
