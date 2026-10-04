'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import ScanPanel from './ScanPanel';

interface Doc { id: string; title: string; type: string; date?: string; pages?: number }
interface Hit { doc: string; title: string; date?: string; page?: number; chunk: string; text: string }

export default function CollectionView({ docs, passages }: { docs: Doc[]; passages: number }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!q.trim()) { setHits(null); return; }
    const ctl = new AbortController();
    const id = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctl.signal })
        .then((r) => r.json())
        .then((j) => setHits(j.hits))
        .catch(() => {});
    }, 250);
    return () => { clearTimeout(id); ctl.abort(); };
  }, [q]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <h1 className="hero-q">The collection</h1>
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => setScanning(true)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><circle cx="12" cy="12" r="3.2" />
          </svg>
          Scan a page
        </button>
      </div>
      {scanning && <ScanPanel onClose={() => { setScanning(false); router.refresh(); }} />}
      <p className="hero-sub">{docs.length} documents · {passages.toLocaleString()} searchable passages. Search the full text, or open a document to read it.</p>
      <div className="askbar" style={{ maxWidth: 900 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search words, names, places, years…" aria-label="Search the collection" />
      </div>
      {hits ? (
        <div style={{ marginTop: 18, maxWidth: 1100 }}>
          {hits.length === 0 && <div className="empty-note">No passages match.</div>}
          {hits.map((h) => (
            <Link key={h.chunk} href={`/doc/${h.doc}?chunk=${encodeURIComponent(h.chunk)}`} className="doc-card" style={{ marginBottom: 12 }}>
              <div className="t">{h.title}</div>
              <div className="m">{[h.date, h.page ? `page ${h.page}` : null].filter(Boolean).join(' · ')}</div>
              <div style={{ marginTop: 8, color: 'var(--ink-2)', fontFamily: 'var(--font-stack-serif)', lineHeight: 1.5 }}>
                {h.text.length > 320 ? h.text.slice(0, 320) + '…' : h.text}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="coll-grid">
          {docs.map((d) => (
            <Link key={d.id} href={`/doc/${d.id}`} className="doc-card">
              <div className="t">{d.title}</div>
              <div className="m">{[d.type, d.date, d.pages ? `${d.pages} pages` : null].filter(Boolean).join(' · ')}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
