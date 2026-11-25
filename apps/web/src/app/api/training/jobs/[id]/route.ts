import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import {
  JOBS_DIR,
  parseTrainLogProgress,
  reconcileJobState,
  requireAuth,
  sanitizeId,
} from '@/lib/training-server';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: 'غير مصرح بالدخول' }, { status: 401 });
  }

  const jobId = sanitizeId(params.id);
  if (!jobId) {
    return NextResponse.json({ success: false, error: 'معرف المهمة غير صالح' }, { status: 400 });
  }

  const jobDir = path.join(JOBS_DIR, jobId);
  const jobPath = path.join(jobDir, 'job.json');
  if (!fs.existsSync(jobPath)) {
    return NextResponse.json({ success: false, error: 'المهمة غير موجودة' }, { status: 404 });
  }

  const job = reconcileJobState(jobPath);
  const logPath = path.join(jobDir, 'train.log');
  const logText = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
  const progress = parseTrainLogProgress(logText, Number(job.epochs || 15), job.status);

  const proofPath = path.join(jobDir, 'proof.json');
  let proof = null;
  if (fs.existsSync(proofPath)) {
    try {
      proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
    } catch {}
  }

  return NextResponse.json({
    success: true,
    job,
    progress,
    proof,
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: 'غير مصرح بالدخول' }, { status: 401 });
  }

  const jobId = sanitizeId(params.id);
  if (!jobId) {
    return NextResponse.json({ success: false, error: 'معرف المهمة غير صالح' }, { status: 400 });
  }

  const jobDir = path.join(JOBS_DIR, jobId);
  const jobPath = path.join(jobDir, 'job.json');
  if (!fs.existsSync(jobPath)) {
    return NextResponse.json({ success: false, error: 'المهمة غير موجودة' }, { status: 404 });
  }

  const job = reconcileJobState(jobPath);
  if (['queued', 'preparing', 'training', 'exporting', 'verifying'].includes(job.status)) {
    return NextResponse.json({ success: false, error: 'لا يمكن حذف مهمة قيد التشغيل' }, { status: 409 });
  }

  fs.rmSync(jobDir, { recursive: true, force: true });
  return NextResponse.json({ success: true });
}
