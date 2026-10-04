'use client';

import Link from 'next/link';
import { useState } from 'react';

type Step = 'live' | 'reading' | 'review' | 'adding' | 'added';
interface Capture { id: string; image: string; text: string; captureMs: number; ocrMs: number }

/**
 * Digitise a page with the Jetson's webcam: live preview → capture → on-device OCR → add to the archive.
 * The camera is read on the server (/api/camera/*), so the browser never asks for camera permission.
 */
export default function ScanPanel({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>('live');
  const [cap, setCap] = useState<Capture | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [added, setAdded] = useState<{ id: string; title: string; passages: number } | null>(null);

  async function capture() {
    setStep('reading');
    setError('');
    try {
      const j = await fetch('/api/camera/capture', { method: 'POST' }).then((r) => r.json());
      if (j.error) throw new Error(j.error);
      setCap(j);
      setTitle(`Scanned page ${new Date().toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`);
      setStep('review');
    } catch (e) {
      setError(`Camera: ${(e as Error).message}`);
      setStep('live');
    }
  }

  async function add() {
    if (!cap) return;
    setStep('adding');
    try {
      const j = await fetch('/api/camera/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: cap.id, title }),
      }).then((r) => r.json());
      if (!j.doc) throw new Error(j.error || 'not added');
      setAdded({ id: j.doc.id, title: j.doc.title, passages: j.passages });
      setStep('added');
    } catch (e) {
      setError((e as Error).message);
      setStep('review');
    }
  }

  const words = cap?.text.split(/\s+/).filter(Boolean).length ?? 0;

  return (
    <div className="scan-overlay" role="dialog" aria-label="Scan a page">
      <div className="scan">
        <div className="scan-head">
          <h2>Digitise a page</h2>
          <span className="scan-steps">
            {(['Capture', 'Read (OCR)', 'Add to archive'] as const).map((s, i) => {
              const at = step === 'live' ? 0 : step === 'reading' || step === 'review' ? 1 : 2;
              return <span key={s} className={i < at || step === 'added' ? 'done' : i === at ? 'on' : ''}>{i + 1}. {s}</span>;
            })}
          </span>
          <button className="btn ghost" onClick={onClose} style={{ marginLeft: 'auto', minHeight: 44 }}>Close</button>
        </div>

        <div className="scan-body">
          <div className="scan-cam">
            {step === 'live' || !cap ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/api/camera/stream" alt="Live camera" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cap.image} alt="Captured page" />
            )}
            {step === 'live' && <div className="scan-frame" aria-hidden />}
            {step === 'reading' && <div className="scan-sweep" aria-hidden />}
            <span className="scan-tag">{step === 'live' ? '● LIVE' : 'CAPTURED'}</span>
          </div>

          <div className="scan-side">
            {step === 'live' && (
              <>
                <p>Hold the page flat and close to the camera so the text fills the frame, then capture.</p>
                <button className="btn" onClick={capture}>Capture page</button>
              </>
            )}
            {step === 'reading' && <p className="scan-busy">Reading the text on the Jetson…</p>}
            {(step === 'review' || step === 'adding') && cap && (
              <>
                <div className="scan-meta">
                  OCR: <b>{words}</b> words · captured in {cap.captureMs} ms · read in {(cap.ocrMs / 1000).toFixed(1)} s
                </div>
                <div className="scan-text selectable">{cap.text || <span className="muted-note">No text found. Move the page closer and try again.</span>}</div>
                <label className="scan-title">
                  Title
                  <input value={title} onChange={(e) => setTitle(e.target.value)} />
                </label>
                <div className="scan-actions">
                  <button className="btn ghost" onClick={() => { setCap(null); setStep('live'); }} disabled={step === 'adding'}>Retake</button>
                  <button className="btn" onClick={add} disabled={step === 'adding' || !cap.text}>
                    {step === 'adding' ? 'Adding and indexing…' : 'Add to archive'}
                  </button>
                </div>
              </>
            )}
            {step === 'added' && added && (
              <>
                <p className="scan-ok">✓ Added to the archive as “{added.title}”: {added.passages} searchable passage{added.passages === 1 ? '' : 's'}.</p>
                <div className="scan-actions">
                  <Link className="btn" href={`/doc/${added.id}`}>Open document</Link>
                  <button className="btn ghost" onClick={() => { setCap(null); setAdded(null); setStep('live'); }}>Scan another</button>
                </div>
              </>
            )}
            {error && <p className="scan-err">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
