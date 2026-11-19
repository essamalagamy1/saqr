import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

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

    // Evict oldest if limit reached
    if (global.detectionSnapshots!.size >= MAX_SNAPSHOTS) {
      const firstKey = global.detectionSnapshots!.keys().next().value;
      if (firstKey) global.detectionSnapshots!.delete(firstKey);
    }

    global.detectionSnapshots!.set(snapshotId, {
      buffer,
      createdAt: Date.now(),
    });

    // Build absolute URL using the request host
    const origin = req.headers.get('x-forwarded-host')
      ? `${req.headers.get('x-forwarded-proto') || 'https'}://${req.headers.get('x-forwarded-host')}`
      : new URL(req.url).origin;

    const url = `${origin}/api/cameras/snapshot/${snapshotId}`;

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
