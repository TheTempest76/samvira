import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans, Source_Serif_4 } from 'next/font/google';
import './globals.css';

// Fonts are downloaded at build time and served locally, so the kiosk needs no internet at runtime.
// Devanagari and Kannada text uses the system Noto fonts (sudo apt install fonts-noto-core).
const serif = Source_Serif_4({ subsets: ['latin'], variable: '--font-serif', display: 'swap' });
const sans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  title: 'Ambedkar Digital Archive',
  description: 'Interactive kiosk for the Dr. B. R. Ambedkar Digital Heritage Archive',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
