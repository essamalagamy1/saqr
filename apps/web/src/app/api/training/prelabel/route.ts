import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { isValidModelKey, requireAuth, runStudioInfer } from '@/lib/training-server';

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: 'غير مصرح بالدخول' }, { status: 401 });
  }

  let tmpPath = '';
  try {
    const form = await req.formData();
    const modelKey = String(form.get('modelKey') || '');
    const file = form.get('image') as File | null;

    if (!isValidModelKey(modelKey)) {
      return NextResponse.json({ success: false, error: 'نموذج غير صالح' }, { status: 400 });
    }
    if (!file || typeof file.arrayBuffer !== 'function') {
      return NextResponse.json({ success: false, error: 'الصورة مطلوبة' }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length === 0 || buf.length > 12 * 1024 * 1024) {
      return NextResponse.json({ success: false, error: 'حجم الصورة غير صالح (الحد الأقصى 12MB)' }, { status: 400 });
    }

    tmpPath = path.join(os.tmpdir(), `saqr_prelabel_${crypto.randomUUID()}.jpg`);
    fs.writeFileSync(tmpPath, buf);

    const result = await runStudioInfer(['infer', modelKey, tmpPath, '--raw', '--conf', '0.25']);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'فشل الرصد التلقائي المبدئي' },
      { status: 500 }
    );
  } finally {
    if (tmpPath && fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  }
}
