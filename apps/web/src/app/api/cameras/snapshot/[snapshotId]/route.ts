import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** GET /api/cameras/snapshot/:snapshotId
 *  Returns the stored JPEG frame for a given detection snapshot ID.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ snapshotId: string }> }
) {
  const { snapshotId } = await params;

  const store = (global as any).detectionSnapshots as
    | Map<string, { buffer: Buffer; createdAt: number }>
    | undefined;

  const snap = store?.get(snapshotId);

  if (!snap || snap.buffer.length < 8000) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(new Uint8Array(snap.buffer), {
    status: 200,
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=86400, immutable', // snapshots are immutable
      'X-Snapshot-Created': String(snap.createdAt),
    },
  });
}
