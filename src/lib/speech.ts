'use client';

import { speakable } from './sentences';

export { splitSentences, speakable, type Sentence } from './sentences';

/**
 * Plays sentences in order through the kiosk's /api/tts (on-device Piper voice), fetching the next ones
 * while the current one plays. Falls back to the browser's voice when the server has no voice for the language.
 */
export class Speaker {
  private queue: { i: number; text: string; audio: Promise<Blob | null> | null }[] = [];
  private playing = false;
  private finished = false;
  private stopped = false;
  private browserOnly = false;
  private ctl = new AbortController();
  private el: HTMLAudioElement | null = null;

  constructor(
    private lang: string,
    private speechLang: string,
    private onActive: (i: number | null) => void,
    private onEnd: () => void,
  ) {}

  push(i: number, sentence: string) {
    const text = speakable(sentence);
    if (this.stopped || !text) return;
    this.queue.push({ i, text, audio: this.browserOnly ? null : this.fetch(text) });
    if (!this.playing) void this.run();
  }

  /** No more sentences are coming; end when the queue drains. */
  finish() {
    this.finished = true;
    if (!this.playing) this.end();
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.ctl.abort();
    this.queue = [];
    this.el?.pause();
    window.speechSynthesis?.cancel();
    this.onActive(null);
    this.onEnd();
  }

  private fetch(text: string): Promise<Blob | null> {
    return fetch('/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, lang: this.lang }),
      signal: this.ctl.signal,
    })
      .then((r) => {
        if (r.status === 404) this.browserOnly = true;
        return r.ok ? r.blob() : null;
      })
      .catch(() => null);
  }

  private async run() {
    this.playing = true;
    while (!this.stopped && this.queue.length) {
      const item = this.queue.shift()!;
      const blob = item.audio ? await item.audio : null;
      if (this.stopped) return;
      this.onActive(item.i);
      if (blob) await this.playBlob(blob);
      else await this.browserSay(item.text);
    }
    this.playing = false;
    if (this.finished) this.end();
  }

  private end() {
    if (this.stopped) return;
    this.stopped = true;
    this.onActive(null);
    this.onEnd();
  }

  private playBlob(blob: Blob) {
    return new Promise<void>((resolve) => {
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      this.el = a;
      const done = () => { URL.revokeObjectURL(url); resolve(); };
      a.onended = done;
      a.onerror = done;
      a.onpause = done;
      a.play().catch(done);
    });
  }

  private browserSay(text: string) {
    return new Promise<void>((resolve) => {
      if (!('speechSynthesis' in window)) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = this.speechLang;
      u.rate = 0.95;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    });
  }
}
