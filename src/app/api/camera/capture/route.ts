import fs from 'node:fs';
import path from 'node:path';
import { adminAllowed, forbidden } from '@/lib/admin';
import { grabFrame } from '@/lib/camera';
import { DATA_DIR } from '@/lib/config';
import { ocrPhoto } from '@/lib/corpus';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SCAN_DIR = path.join(DATA_DIR, 'scans');

/** Takes a picture with the webcam and reads it with OCR. Nothing is added to the archive until /api/camera/commit. */
export async function POST(req: Request) {
  if (!adminAllowed(req)) return forbidden();
  const t0 = Date.now();
  try {
    const jpeg = await grabFrame();
    // Only the latest capture is kept until it's added (or replaced).
    fs.rmSync(SCAN_DIR, { recursive: true, force: true });
    fs.mkdirSync(SCAN_DIR, { recursive: true });
    const id = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
    const file = path.join(SCAN_DIR, `${id}.jpg`);
    fs.writeFileSync(file, jpeg);
    const captureMs = Date.now() - t0;
    const text = (await ocrPhoto(file)).replace(/\n{3,}/g, '\n\n').trim();
    return Response.json({
      id, text, captureMs, ocrMs: Date.now() - t0 - captureMs,
      image: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
