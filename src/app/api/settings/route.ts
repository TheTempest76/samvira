import { adminAllowed, forbidden } from '@/lib/admin';
import { getSettings, updateSettings } from '@/lib/settings';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(getSettings());
}
export async function POST(req: Request) {
  if (!adminAllowed(req)) return forbidden();
  const patch = await req.json().catch(() => ({}));
  return Response.json(updateSettings(patch));
}
