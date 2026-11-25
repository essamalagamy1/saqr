import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { MODEL_DEFS, MODELS_DIR, isValidModelKey, requireAuth, runStudioInfer, sha256File } from '@/lib/training-server';

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: 'غير مصرح بالدخول' }, { status: 401 });
  }

  let tmpPath = '';
  try {
    const form = await req.formData();
    const modelKey = String(form.get('modelKey') || '');
    const mode = String(form.get('mode') || 'raw'); // 'raw' | 'prod'
    const rawConf = form.get('conf');
    const conf = rawConf !== null && String(rawConf).trim() !== ''
      ? Math.min(0.95, Math.max(0.05, parseFloat(String(rawConf)) || 0.25))
      : null;
    const file = form.get('image') as File | null;

    if (!isValidModelKey(modelKey)) {
      return NextResponse.json({ success: false, error: 'نموذج غير صالح' }, { status: 400 });
    }
    if (!file || typeof file.arrayBuffer !== 'function') {
      return NextResponse.json({ success: false, error: 'الصورة مطلوبة' }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length === 0 || buf.length > 12 * 1024 * 1024) {
      return NextResponse.json({ success: false, error: 'حجم الصورة غير صالح' }, { status: 400 });
    }

    tmpPath = path.join(os.tmpdir(), `saqr_test_${crypto.randomUUID()}.jpg`);
    fs.writeFileSync(tmpPath, buf);

    const args = ['infer', modelKey, tmpPath];
    if (conf !== null) args.push('--conf', String(conf));
    if (mode !== 'prod') args.push('--raw');

    const result = await runStudioInfer(args);
    const onnxPath = path.join(MODELS_DIR, MODEL_DEFS[modelKey].onnxName);
    const sha256 = sha256File(onnxPath);

    return NextResponse.json({
      ...result,
      mode,
      modelSha256Short: sha256 ? sha256.slice(0, 12) : '',
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'فشل اختبار النموذج على الصورة' },
      { status: 500 }
    );
  } finally {
    if (tmpPath && fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  }
}
