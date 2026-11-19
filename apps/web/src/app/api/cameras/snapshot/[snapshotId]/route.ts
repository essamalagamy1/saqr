import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const STORAGE_DIR = process.env.SNAPSHOT_STORAGE_DIR || '/mnt/essam/sites/saqr/storage/snapshots';
const HOT_DIR = path.join(STORAGE_DIR, 'hot');
const PINNED_DIR = path.join(STORAGE_DIR, 'pinned');
const WARM_DIR = path.join(STORAGE_DIR, 'warm');

/** GET /api/cameras/snapshot/:snapshotId
 *  Returns the stored frame for a given detection snapshot ID across all storage tiers.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ snapshotId: string }> }
) {
  const { snapshotId } = await params;

  // 1. Check in-memory store (fastest, < 1ms)
  const store = (global as any).detectionSnapshots as
    | Map<string, { buffer: Buffer; createdAt: number }>
    | undefined;

  const snap = store?.get(snapshotId);
  if (snap && snap.buffer && snap.buffer.length >= 8000) {
    return new NextResponse(new Uint8Array(snap.buffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400, immutable',
        'X-Storage-Tier': 'hot-memory',
        'X-Snapshot-Created': String(snap.createdAt),
      },
    });
  }

  // 2. Check Hot Disk Tier
  const hotPath = path.join(HOT_DIR, `${snapshotId}.jpg`);
  if (fs.existsSync(hotPath)) {
    try {
      const buffer = await fs.promises.readFile(hotPath);
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=86400, immutable',
          'X-Storage-Tier': 'hot-disk',
        },
      });
    } catch {}
  }

  // 3. Check Pinned Disk Tier
  const pinnedPath = path.join(PINNED_DIR, `${snapshotId}.jpg`);
  if (fs.existsSync(pinnedPath)) {
    try {
      const buffer = await fs.promises.readFile(pinnedPath);
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=86400, immutable',
          'X-Storage-Tier': 'pinned',
        },
      });
    } catch {}
  }

  // 4. Check Warm Disk Tier (Compressed WebP)
  const warmPath = path.join(WARM_DIR, `${snapshotId}.webp`);
  if (fs.existsSync(warmPath)) {
    try {
      const buffer = await fs.promises.readFile(warmPath);
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': 'image/webp',
          'Cache-Control': 'public, max-age=86400, immutable',
          'X-Storage-Tier': 'warm-webp',
        },
      });
    } catch {}
  }

  // 5. Cold Tier Fallback (Snapshot purged after 90 days, data retained)
  const archivedSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
    <rect width="640" height="360" fill="#080e1a"/>
    <rect x="20" y="20" width="600" height="320" rx="12" fill="#0d1527" stroke="#1e293b" stroke-width="2"/>
    <circle cx="320" cy="150" r="36" fill="#1e293b"/>
    <path d="M308 150l8 8 16-16" stroke="#38bdf8" stroke-width="3" fill="none" stroke-linecap="round"/>
    <text x="320" y="215" fill="#94a3b8" font-family="sans-serif" font-size="14" font-weight="bold" text-anchor="middle">تمت أرشفة الصورة (Cold Tier &gt; 90 يوم)</text>
    <text x="320" y="240" fill="#64748b" font-family="sans-serif" font-size="11" text-anchor="middle">بيانات الكشف وسجل المخالفة محفوظة بالكامل في التقارير الإحصائية</text>
  </svg>`;

  return new NextResponse(archivedSvg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'X-Storage-Tier': 'cold-archived',
    },
  });
}
