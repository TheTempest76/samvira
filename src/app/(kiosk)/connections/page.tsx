import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '@/lib/config';
import { indexStats } from '@/lib/retrieval';
import GraphView, { GraphData } from '@/components/GraphView';

export const dynamic = 'force-dynamic';

export default async function ConnectionsPage() {
  const g: GraphData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'graph.json'), 'utf8'));
  const stats = await indexStats();
  const titles = Object.fromEntries(stats.docs.map((d) => [d.id, d.title]));
  return <GraphView data={g} docTitles={titles} />;
}
