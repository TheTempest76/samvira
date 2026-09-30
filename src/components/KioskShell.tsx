'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

export type Lang = 'en' | 'hi' | 'mr' | 'kn';
export const LANGS: { id: Lang; native: string; speech: string }[] = [
  { id: 'en', native: 'English', speech: 'en-IN' },
  { id: 'hi', native: 'हिन्दी', speech: 'hi-IN' },
  { id: 'mr', native: 'मराठी', speech: 'mr-IN' },
  { id: 'kn', native: 'ಕನ್ನಡ', speech: 'kn-IN' },
];

// UI strings. Translations are a first draft — have a native speaker review before public use.
const T = {
  ask: { en: 'Ask', hi: 'पूछें', mr: 'विचारा', kn: 'ಕೇಳಿ' },
  timeline: { en: 'Timeline', hi: 'समयरेखा', mr: 'कालरेषा', kn: 'ಕಾಲರೇಖೆ' },
  connections: { en: 'Connections', hi: 'संबंध', mr: 'संबंध', kn: 'ಸಂಬಂಧಗಳು' },
  collection: { en: 'Collection', hi: 'संग्रह', mr: 'संग्रह', kn: 'ಸಂಗ್ರಹ' },
  heroQ: {
    en: 'Ask the archive',
    hi: 'संग्रह से पूछिए',
    mr: 'संग्रहाला विचारा',
    kn: 'ಸಂಗ್ರಹವನ್ನು ಕೇಳಿ',
  },
  heroSub: {
    en: 'Every answer comes from the archive and shows its sources. If the archive does not hold the answer, the kiosk will say so.',
    hi: 'हर उत्तर संग्रह से आता है और उसके स्रोत दिखाए जाते हैं। यदि संग्रह में उत्तर नहीं है, तो कियोस्क यही बताएगा।',
    mr: 'प्रत्येक उत्तर संग्रहातून येते आणि त्याचे स्रोत दाखवले जातात. संग्रहात उत्तर नसेल तर किऑस्क तसे सांगेल.',
    kn: 'ಪ್ರತಿ ಉತ್ತರವೂ ಸಂಗ್ರಹದಿಂದ ಬರುತ್ತದೆ ಮತ್ತು ಅದರ ಮೂಲಗಳನ್ನು ತೋರಿಸುತ್ತದೆ. ಸಂಗ್ರಹದಲ್ಲಿ ಉತ್ತರವಿಲ್ಲದಿದ್ದರೆ ಕಿಯೋಸ್ಕ್ ಅದನ್ನೇ ಹೇಳುತ್ತದೆ.',
  },
  placeholder: {
    en: 'Type a question, or tap the microphone…',
    hi: 'प्रश्न लिखें या माइक दबाएँ…',
    mr: 'प्रश्न लिहा किंवा माइक दाबा…',
    kn: 'ಪ್ರಶ್ನೆ ಬರೆಯಿರಿ ಅಥವಾ ಮೈಕ್ ಒತ್ತಿರಿ…',
  },
  askBtn: { en: 'Ask', hi: 'पूछें', mr: 'विचारा', kn: 'ಕೇಳಿ' },
  sources: { en: 'Sources from the archive', hi: 'संग्रह के स्रोत', mr: 'संग्रहातील स्रोत', kn: 'ಸಂಗ್ರಹದ ಮೂಲಗಳು' },
  open: { en: 'Open document →', hi: 'दस्तावेज़ खोलें →', mr: 'दस्तऐवज उघडा →', kn: 'ದಾಖಲೆ ತೆರೆಯಿರಿ →' },
  listen: { en: 'Read aloud', hi: 'सुनें', mr: 'ऐका', kn: 'ಕೇಳಿಸಿ' },
  stop: { en: 'Stop', hi: 'रोकें', mr: 'थांबवा', kn: 'ನಿಲ್ಲಿಸಿ' },
  touch: { en: 'Touch anywhere to begin', hi: 'शुरू करने के लिए स्पर्श करें', mr: 'सुरू करण्यासाठी स्पर्श करा', kn: 'ಪ್ರಾರಂಭಿಸಲು ಸ್ಪರ್ಶಿಸಿ' },
  askAbout: { en: 'Ask about this', hi: 'इसके बारे में पूछें', mr: 'याबद्दल विचारा', kn: 'ಇದರ ಬಗ್ಗೆ ಕೇಳಿ' },
} as const;
export type TKey = keyof typeof T;

interface Ctx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: TKey) => string;
}
const LangCtx = createContext<Ctx>({ lang: 'en', setLang: () => {}, t: (k) => T[k].en });
export const useKiosk = () => useContext(LangCtx);

const IDLE_MS = 120_000;

export default function KioskShell({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');
  const [idle, setIdle] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('kiosk-lang') as Lang | null;
      if (saved && LANGS.some((l) => l.id === saved)) setLangState(saved);
    } catch { /* storage unavailable */ }
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    document.documentElement.lang = l;
    try { sessionStorage.setItem('kiosk-lang', l); } catch { /* ignore */ }
  }, []);

  // Idle reset: after 2 minutes without touch, return to the start screen for the next visitor.
  useEffect(() => {
    const reset = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setIdle(true);
        window.speechSynthesis?.cancel();
        setLang('en');
        router.push('/');
        window.dispatchEvent(new Event('kiosk-reset'));
      }, IDLE_MS);
    };
    const evs = ['pointerdown', 'keydown', 'touchstart', 'wheel'];
    evs.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      evs.forEach((e) => window.removeEventListener(e, reset));
      if (timer.current) clearTimeout(timer.current);
    };
  }, [router, setLang]);

  const t = useCallback((k: TKey) => T[k][lang] ?? T[k].en, [lang]);
  const nav: { href: string; key: TKey }[] = [
    { href: '/', key: 'ask' },
    { href: '/timeline', key: 'timeline' },
    { href: '/connections', key: 'connections' },
    { href: '/collection', key: 'collection' },
  ];

  return (
    <LangCtx.Provider value={{ lang, setLang, t }}>
      <div className="kiosk">
        <header className="topbar">
          <Link href="/" className="brand" aria-label="Home">
            <span className="brand-mark" aria-hidden>A</span>
            <span>
              <div className="brand-name">Dr. B. R. Ambedkar</div>
              <div className="brand-sub">Digital Heritage Archive</div>
            </span>
          </Link>
          <nav className="nav">
            {nav.map((n) => {
              const active = n.href === '/' ? pathname === '/' : pathname.startsWith(n.href) || (n.href === '/collection' && pathname.startsWith('/doc'));
              return (
                <Link key={n.href} href={n.href} aria-current={active ? 'page' : undefined}>
                  {t(n.key)}
                </Link>
              );
            })}
          </nav>
          <div className="lang" role="group" aria-label="Language">
            {LANGS.map((l) => (
              <button key={l.id} aria-pressed={lang === l.id} onClick={() => setLang(l.id)}>
                {l.native}
              </button>
            ))}
          </div>
        </header>
        <main className="page">{children}</main>
        {idle && (
          <div className="idle-overlay" onClick={() => setIdle(false)} role="button" aria-label="Start">
            <div>
              <h2>Dr. B. R. Ambedkar</h2>
              <p>Digital Heritage Archive · डिजिटल विरासत संग्रह · ಡಿಜಿಟಲ್ ಪರಂಪರೆ ಸಂಗ್ರಹ</p>
              <div className="touch">{T.touch.en} · {T.touch.hi}</div>
            </div>
          </div>
        )}
      </div>
    </LangCtx.Provider>
  );
}
