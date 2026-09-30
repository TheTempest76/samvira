'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useKiosk } from './KioskShell';

export interface GraphData {
  nodes: { id: string; label: string; kind: 'person' | 'place' | 'work' | 'org' | 'event' }[];
  edges: { source: string; target: string; label: string; doc: string }[];
}

// One hue per entity kind; kind is also written in the side panel, so colour is never the only cue.
const KIND: Record<string, { color: string; name: string }> = {
  person: { color: '#1f3f99', name: 'Person' },
  event: { color: '#c2571a', name: 'Event' },
  work: { color: '#2c7a4b', name: 'Work' },
  org: { color: '#7a3d91', name: 'Organisation' },
  place: { color: '#8a6d1d', name: 'Place' },
};

type N = GraphData['nodes'][number] & { x: number; y: number; anchor: 'start' | 'middle' | 'end'; lx: number; ly: number };
type L = { source: N; target: N; label: string; doc: string };

const W = 1180, H = 780;

export default function GraphView({ data, docTitles }: { data: GraphData; docTitles: Record<string, string> }) {
  const { t } = useKiosk();
  const [sel, setSel] = useState<string>('ambedkar');

  const { nodes, links } = useMemo(() => {
    // Deterministic radial layout: the hub in the centre, its direct links evenly round an ellipse,
    // second-degree nodes pushed outward along their parent's angle. Labels sit on the outer side.
    const hub = 'ambedkar';
    const cx = W / 2, cy = H / 2, RX = 320, RY = 240, OUT = 1.62;
    const nodes: N[] = data.nodes.map((n) => ({ ...n, x: cx, y: cy, anchor: 'middle', lx: cx, ly: cy }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const adj = (id: string) => data.edges.filter((e) => e.source === id || e.target === id).map((e) => (e.source === id ? e.target : e.source));
    const ring = adj(hub).filter((id, i, a) => a.indexOf(id) === i);
    const outer = nodes.filter((n) => n.id !== hub && !ring.includes(n.id));
    const parentOf = new Map(outer.map((n) => [n.id, adj(n.id).find((p) => ring.includes(p)) ?? ring[0]]));
    const parents = [...new Set(parentOf.values())];

    const slots = ring.map((_, i) => -Math.PI / 2 + (i * 2 * Math.PI) / ring.length);
    const free = new Set(slots.map((_, i) => i));
    const angle = new Map<string, number>();
    const diagonals = [-Math.PI / 4, Math.PI / 4, (3 * Math.PI) / 4, (-3 * Math.PI) / 4];
    parents.forEach((pid, k) => {
      const target = diagonals[k % 4];
      const diff = (a: number) => Math.abs(Math.atan2(Math.sin(a - target), Math.cos(a - target)));
      const best = [...free].sort((i, j) => diff(slots[i]) - diff(slots[j]))[0];
      free.delete(best);
      angle.set(pid, slots[best]);
    });
    const kindOrder = ['event', 'work', 'org', 'place', 'person'];
    const rest = ring.filter((id) => !angle.has(id)).sort((a, b) => kindOrder.indexOf(byId.get(a)!.kind) - kindOrder.indexOf(byId.get(b)!.kind));
    const freeSorted = [...free].sort((a, b) => a - b);
    rest.forEach((id, i) => angle.set(id, slots[freeSorted[i]]));

    const place = (n: N, a: number, f: number) => {
      n.x = cx + Math.cos(a) * RX * f;
      n.y = cy + Math.sin(a) * RY * f;
      const c = Math.cos(a), sn = Math.sin(a);
      if (c > 0.35) { n.anchor = 'start'; n.lx = n.x + 20; n.ly = n.y + 5; }
      else if (c < -0.35) { n.anchor = 'end'; n.lx = n.x - 20; n.ly = n.y + 5; }
      else { n.anchor = 'middle'; n.lx = n.x; n.ly = sn < 0 ? n.y - 22 : n.y + 32; }
    };
    const hubNode = byId.get(hub)!;
    hubNode.x = cx; hubNode.y = cy; hubNode.anchor = 'middle'; hubNode.lx = cx; hubNode.ly = cy + 46;
    for (const id of ring) place(byId.get(id)!, angle.get(id)!, 1);
    const siblings = new Map<string, number>();
    for (const n of outer) {
      const p = parentOf.get(n.id)!;
      const k = siblings.get(p) ?? 0;
      siblings.set(p, k + 1);
      place(n, angle.get(p)! + k * 0.18, OUT);
    }
    const links: L[] = data.edges.map((e) => ({ ...e, source: byId.get(e.source)!, target: byId.get(e.target)! }));
    return { nodes, links };
  }, [data]);

  const node = (id: string) => nodes.find((n) => n.id === id)!;
  const rels = links.filter((l) => l.source.id === sel || l.target.id === sel);
  const neighbours = new Set(rels.flatMap((l) => [l.source.id, l.target.id]));
  const cur = node(sel);

  return (
    <div className="graph-wrap">
      <div className="graph-box">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Network of people, events, works, organisations and places">
          {links.map((l, i) => {
            const s = l.source, tt = l.target;
            const on = s.id === sel || tt.id === sel;
            return (
              <line key={i} x1={s.x} y1={s.y} x2={tt.x} y2={tt.y} stroke={on ? '#1f3f99' : '#cfc7b5'} strokeWidth={on ? 2.5 : 1.5} />
            );
          })}
          {nodes.map((n) => {
            const on = n.id === sel;
            const near = neighbours.has(n.id);
            const r = n.id === 'ambedkar' ? 20 : 13;
            return (
              <g key={n.id} transform={`translate(${n.x},${n.y})`} onClick={() => setSel(n.id)} style={{ cursor: 'pointer' }} opacity={on || near || !sel ? 1 : 0.45}>
                <circle r={30} fill="transparent" />
                <circle r={r} fill={KIND[n.kind].color} stroke="#fffdf8" strokeWidth={3} />
                {on && <circle r={r + 6} fill="none" stroke={KIND[n.kind].color} strokeWidth={2} />}
                <text x={n.lx - n.x} y={n.ly - n.y} textAnchor={n.anchor} fontSize={on ? 17 : 15} fontWeight={on ? 700 : 500} fill="#1a1c21" style={{ paintOrder: 'stroke', stroke: '#fffdf8', strokeWidth: 4 }}>
                  {n.label}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="legend">
          {Object.values(KIND).map((k) => (
            <span key={k.name}><i style={{ background: k.color }} />{k.name}</span>
          ))}
        </div>
      </div>
      <aside className="panel">
        <div className="meta">{KIND[cur.kind].name}</div>
        <h3>{cur.label}</h3>
        <div>
          {rels.map((l, i) => {
            const s = l.source, tt = l.target;
            const other = s.id === sel ? tt : s;
            const phrase = s.id === sel ? `${l.label} →` : `← ${l.label}`;
            return (
              <div className="rel" key={i}>
                <span className="verb">{phrase}</span>
                <span style={{ flex: 1 }}>
                  <button className="chip" style={{ minHeight: 40, padding: '6px 14px' }} onClick={() => setSel(other.id)}>{other.label}</button>
                  <div className="meta" style={{ margin: '6px 0 0' }}>
                    Source: <Link href={`/doc/${l.doc}`} style={{ color: 'var(--blue)' }}>{docTitles[l.doc] ?? l.doc}</Link>
                  </div>
                </span>
              </div>
            );
          })}
        </div>
        <div className="actions">
          <Link className="btn" href={`/?q=${encodeURIComponent(cur.label)}`}>{t('askAbout')}</Link>
        </div>
      </aside>
    </div>
  );
}
