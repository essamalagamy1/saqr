import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { JOBS_DIR, requireAuth, sanitizeId } from '@/lib/training-server';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth(req, true);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: 'غير مصرح بالدخول' }, { status: 401 });
  }

  const jobId = sanitizeId(params.id);
  const fileName = req.nextUrl.searchParams.get('name') || '';
  if (!jobId || !/^[a-zA-Z0-9_.-]+\.(jpg|jpeg|png|webp)$/i.test(fileName)) {
    return NextResponse.json({ success: false, error: 'طلب صورة غير صالح' }, { status: 400 });
  }

  const filePath = path.join(JOBS_DIR, jobId, 'samples', path.basename(fileName));
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ success: false, error: 'الصورة غير موجودة' }, { status: 404 });
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  const buf = fs.readFileSync(filePath);

  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
