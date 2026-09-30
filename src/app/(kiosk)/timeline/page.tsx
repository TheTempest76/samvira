import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '@/lib/config';
import { getDoc } from '@/lib/retrieval';
import TimelineView, { TLItem } from '@/components/TimelineView';

export const dynamic = 'force-dynamic';

export default async function TimelinePage() {
  const items: Omit<TLItem, 'docTitle' | 'docText'>[] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'timeline.json'), 'utf8'));
  const cache = new Map<string, { title: string; text: string }>();
  for (const it of items) {
    if (cache.has(it.doc)) continue;
    const d = await getDoc(it.doc);
    cache.set(it.doc, { title: d?.doc.title ?? it.doc, text: d ? d.chunks.map((c) => c.text).join('\n\n') : '' });
  }
  const full: TLItem[] = items.map((it) => ({ ...it, docTitle: cache.get(it.doc)!.title, docText: cache.get(it.doc)!.text }));
  return <TimelineView items={full} />;
}
