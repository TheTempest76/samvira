'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Tap to record, tap again (or wait 12 s) to stop. Audio is sent to /api/transcribe,
 * which forwards it to the configured speech-to-text server (local Whisper or online).
 * Hidden when no STT server is configured or the browser has no microphone access.
 */
export default function VoiceButton({ lang, onText, onStatus }: { lang: string; onText: (t: string) => void; onStatus: (s: string) => void }) {
  const [available, setAvailable] = useState(false);
  const [rec, setRec] = useState(false);
  const mr = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch('/api/voice')
      .then((r) => r.json())
      .then((j) => setAvailable(!!j.stt && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices))
      .catch(() => setAvailable(false));
  }, []);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const r = new MediaRecorder(stream);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRec(false);
        const blob = new Blob(chunks.current, { type: r.mimeType || 'audio/webm' });
        if (blob.size < 2000) { onStatus(''); return; }
        onStatus('Listening back…');
        const fd = new FormData();
        fd.append('file', blob, 'speech.webm');
        fd.append('lang', lang);
        try {
          const res = await fetch('/api/transcribe', { method: 'POST', body: fd });
          const j = await res.json();
          if (j.text) { onStatus(''); onText(j.text); }
          else onStatus(j.error ? `Voice input failed: ${j.error}` : "Sorry, I didn't catch that.");
        } catch {
          onStatus('Voice input failed.');
        }
      };
      mr.current = r;
      r.start();
      setRec(true);
      onStatus('Listening… tap the microphone again when you finish.');
      stopTimer.current = setTimeout(() => r.state === 'recording' && r.stop(), 12000);
    } catch {
      onStatus('Microphone not available.');
    }
  }

  function stop() {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    if (mr.current?.state === 'recording') mr.current.stop();
  }

  if (!available) return null;
  return (
    <button type="button" className={`btn round ${rec ? 'rec' : 'ghost'}`} onClick={rec ? stop : start} aria-label={rec ? 'Stop recording' : 'Ask by voice'}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        {rec ? <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" /> : (
          <>
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </>
        )}
      </svg>
    </button>
  );
}
