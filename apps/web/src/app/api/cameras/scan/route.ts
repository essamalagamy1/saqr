import { NextResponse } from 'next/server';
import { CameraScanner } from '@/lib/camera-scanner';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const scanner = new CameraScanner();
    const cameras = await scanner.scanNetwork();
    return NextResponse.json({ success: true, cameras });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'فشل فحص كاميرات الشبكة' },
      { status: 500 }
    );
  }
}

export async function POST() {
  return GET();
}
