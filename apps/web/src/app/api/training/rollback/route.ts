import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import {
  BACKUPS_DIR,
  CV_DIR,
  MANIFEST_FILE,
  MODEL_DEFS,
  MODELS_DIR,
  RELOAD_SIGNAL,
  isValidModelKey,
  listBackupsForModel,
  readActiveLock,
  requireAuth,
  runStudioInfer,
  sha256File,
} from '@/lib/training-server';

function atomicCopy(src: string, dst: string) {
  const tmp = `${dst}.tmp`;
  fs.copyFileSync(src, tmp);
  fs.renameSync(tmp, dst);
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: 'غير مصرح بالدخول' }, { status: 401 });
  }

  const lock = readActiveLock();
  if (lock.locked) {
    return NextResponse.json({ success: false, error: 'لا يمكن الاسترجاع أثناء وجود تدريب نشط' }, { status: 409 });
  }

  try {
    const body = await req.json();
    const modelKey = String(body?.modelKey || '');
    if (!isValidModelKey(modelKey)) {
      return NextResponse.json({ success: false, error: 'نموذج غير صالح' }, { status: 400 });
    }

    const backups = listBackupsForModel(modelKey);
    if (backups.length === 0) {
      return NextResponse.json({ success: false, error: 'لا توجد نسخة احتياطية سابقة لهذا النموذج' }, { status: 404 });
    }

    const latestBackup = backups[0];
    const backupDir = path.join(BACKUPS_DIR, latestBackup);
    const def = MODEL_DEFS[modelKey];
    const backupOnnx = path.join(backupDir, def.onnxName);
    const backupPt = path.join(backupDir, 'best.pt');

    if (!fs.existsSync(backupOnnx)) {
      return NextResponse.json({ success: false, error: 'ملف النسخة الاحتياطية مفقود' }, { status: 404 });
    }

    // Validate backup ONNX before restoring
    await runStudioInfer(['validate', backupOnnx, modelKey]);

    const prodOnnx = path.join(MODELS_DIR, def.onnxName);
    const prodPt = path.join(CV_DIR, def.cvDir, 'weights', 'best.pt');

    atomicCopy(backupOnnx, prodOnnx);
    if (fs.existsSync(backupPt)) {
      atomicCopy(backupPt, prodPt);
    }

    const sha256 = sha256File(prodOnnx);

    // Update studio_manifest.json atomically
    let manifest: any = { models: {} };
    if (fs.existsSync(MANIFEST_FILE)) {
      try {
        manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
      } catch {}
    }
    manifest.models = manifest.models || {};
    manifest.models[modelKey] = {
      studioTrained: false,
      restoredFrom: latestBackup,
      updatedAt: new Date().toISOString(),
      sha256,
      ...(modelKey === 'phone' ? { phoneMode: 'coco' } : {}),
    };
    const tmpManifest = `${MANIFEST_FILE}.tmp`;
    fs.writeFileSync(tmpManifest, JSON.stringify(manifest, null, 2), 'utf8');
    fs.renameSync(tmpManifest, MANIFEST_FILE);
    fs.writeFileSync(RELOAD_SIGNAL, new Date().toISOString(), 'utf8');

    // Remove the consumed backup folder so subsequent rollbacks step back further
    fs.rmSync(backupDir, { recursive: true, force: true });

    return NextResponse.json({
      success: true,
      modelKey,
      restoredFrom: latestBackup,
      sha256Short: sha256.slice(0, 12),
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'فشل استرجاع النسخة السابقة' },
      { status: 500 }
    );
  }
}
