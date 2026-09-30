import { querySummary, recentQueries } from '@/lib/metrics';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  return Response.json({ summary: querySummary(), recent: recentQueries(25) });
}
