import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const STORAGE_DIR = process.env.SNAPSHOT_STORAGE_DIR || '/mnt/essam/sites/saqr/storage/snapshots';
const HOT_DIR = path.join(STORAGE_DIR, 'hot');

// Ensure hot directory exists
try {
  if (!fs.existsSync(HOT_DIR)) {
    fs.mkdirSync(HOT_DIR, { recursive: true });
  }
} catch (e) {
  console.warn('Failed to initialize storage directory:', e);
}

// In-memory snapshot store: snapshotId → { buffer, createdAt }
declare global {
  var detectionSnapshots:
    | Map<string, { buffer: Buffer; createdAt: number }>
    | undefined;
}

if (!global.detectionSnapshots) {
  global.detectionSnapshots = new Map();
}

const MAX_SNAPSHOTS = 500; // keep last 500 detection snapshots in memory

/** POST /api/cameras/snapshot
 *  Body: raw JPEG bytes (application/octet-stream)
 *  Headers: x-snapshot-id (optional, server generates one if missing)
 *  Returns: { snapshotId, url }
 */
export async function POST(req: NextRequest) {
  try {
    const arrayBuffer = await req.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength < 8000) {
      return NextResponse.json(
        { success: false, error: 'Empty or invalid snapshot (min 8KB required)' },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(arrayBuffer);
    const snapshotId =
      req.headers.get('x-snapshot-id') ||
      `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // 1. Evict oldest if memory limit reached
    if (global.detectionSnapshots!.size >= MAX_SNAPSHOTS) {
      const firstKey = global.detectionSnapshots!.keys().next().value;
      if (firstKey) global.detectionSnapshots!.delete(firstKey);
    }

    // 2. Save in fast memory cache
    global.detectionSnapshots!.set(snapshotId, {
      buffer,
      createdAt: Date.now(),
    });

    // 3. Save to Tiered Storage Disk (Hot Tier: original quality)
    try {
      const filePath = path.join(HOT_DIR, `${snapshotId}.jpg`);
      fs.promises.writeFile(filePath, buffer).catch((err) => {
        console.warn('Error saving snapshot to disk:', err.message);
      });
    } catch {}

    const url = `/api/cameras/snapshot/${snapshotId}`;

    return NextResponse.json({ success: true, snapshotId, url });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const count = global.detectionSnapshots?.size ?? 0;
  return NextResponse.json({ success: true, count });
}
