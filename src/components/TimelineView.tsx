'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useKiosk } from './KioskShell';

export interface TLItem {
  year: number;
  date: string;
  title: string;
  doc: string;
  era: string;
  docTitle: string;
  docText: string;
}

export default function TimelineView({ items }: { items: TLItem[] }) {
  const { t } = useKiosk();
  const eras = useMemo(() => [...new Set(items.map((i) => i.era))], [items]);
  const [era, setEra] = useState<string | null>(null);
  const [sel, setSel] = useState<number>(0);
  const shown = items.map((it, i) => ({ it, i })).filter(({ it }) => !era || it.era === era);
  const cur = items[sel];

  let lastEra = '';
  return (
    <div className="tl-wrap">
      <section>
        <div className="tl-eras">
          <button className="chip" aria-pressed={era === null} style={era === null ? { borderColor: 'var(--blue)', color: 'var(--blue)' } : undefined} onClick={() => setEra(null)}>All years</button>
          {eras.map((e) => (
            <button key={e} className="chip" style={era === e ? { borderColor: 'var(--blue)', color: 'var(--blue)' } : undefined} onClick={() => setEra(e)}>{e}</button>
          ))}
        </div>
        <div className="tl">
          {shown.map(({ it, i }) => {
            const head = it.era !== lastEra ? it.era : null;
            lastEra = it.era;
            return (
              <div key={i}>
                {head && <div className="tl-era-head">{head}</div>}
                <button className={`tl-item${sel === i ? ' active' : ''}`} onClick={() => setSel(i)}>
                  <span className="tl-date">{it.date}</span>
                  <span className="tl-title">{it.title}</span>
                </button>
              </div>
            );
          })}
        </div>
      </section>
      {cur && (
        <aside className="panel">
          <div className="meta">{cur.date} · {cur.era}</div>
          <h3>{cur.title}</h3>
          <div className="meta">From: {cur.docTitle}</div>
          <div className="actions" style={{ margin: '4px 0 18px' }}>
            <Link className="btn" href={`/?q=${encodeURIComponent(cur.title)}`}>{t('askAbout')}</Link>
            <Link className="btn ghost" href={`/doc/${cur.doc}`}>{t('open')}</Link>
          </div>
          <div className="body selectable">{cur.docText.split('\n\n').slice(0, 3).map((p, i) => <p key={i}>{p}</p>)}</div>
        </aside>
      )}
    </div>
  );
}
