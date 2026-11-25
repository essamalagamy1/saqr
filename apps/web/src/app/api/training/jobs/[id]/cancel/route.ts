import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import {
  JOBS_DIR,
  LOCK_FILE,
  isPidAlive,
  requireAuth,
  sanitizeId,
} from '@/lib/training-server';

export async function POST(
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

  const jobPath = path.join(JOBS_DIR, jobId, 'job.json');
  if (!fs.existsSync(jobPath)) {
    return NextResponse.json({ success: false, error: 'المهمة غير موجودة' }, { status: 404 });
  }

  const job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
  if (job.pid && isPidAlive(Number(job.pid))) {
    try {
      process.kill(Number(job.pid), 'SIGTERM');
    } catch {}
  }

  job.status = 'failed';
  job.error = 'تم إلغاء التدريب بواسطة المستخدم';
  job.updatedAt = new Date().toISOString();
  fs.writeFileSync(jobPath, JSON.stringify(job, null, 2), 'utf8');

  if (fs.existsSync(LOCK_FILE)) {
    try {
      const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      if (lock.jobId === jobId) {
        fs.unlinkSync(LOCK_FILE);
      }
    } catch {
      try { fs.unlinkSync(LOCK_FILE); } catch {}
    }
  }

  return NextResponse.json({ success: true, job });
}
