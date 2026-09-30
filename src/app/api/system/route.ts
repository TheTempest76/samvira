import { systemSnapshot } from '@/lib/jetson';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  return Response.json(systemSnapshot(), { headers: { 'cache-control': 'no-store' } });
}
