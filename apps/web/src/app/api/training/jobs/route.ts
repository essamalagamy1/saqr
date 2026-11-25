import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { NextRequest, NextResponse } from 'next/server';
import {
  JOBS_DIR,
  LOCK_FILE,
  MODEL_DEFS,
  PYTHON_BIN,
  SAQR_ROOT,
  TRAIN_SCRIPT,
  ensureStudioDirs,
  isValidModelKey,
  readActiveLock,
  reconcileJobState,
  requireAuth,
} from '@/lib/training-server';

function detectImageExtension(buf: Buffer): '.jpg' | '.png' | '.webp' | null {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return '.png';
  // WebP: RIFF....WEBP
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return '.webp';
  }
  return null;
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: 'غير مصرح بالدخول' }, { status: 401 });
  }

  ensureStudioDirs();
  const entries = fs.readdirSync(JOBS_DIR, { withFileTypes: true }).filter(d => d.isDirectory());

  const jobs = [];
  for (const dir of entries) {
    const jobPath = path.join(JOBS_DIR, dir.name, 'job.json');
    if (!fs.existsSync(jobPath)) continue;
    try {
      const job = reconcileJobState(jobPath);
      jobs.push(job);
    } catch {}
  }

  jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return NextResponse.json({
    success: true,
    jobs: jobs.slice(0, 20),
    activeLock: readActiveLock(),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: 'غير مصرح بالدخول' }, { status: 401 });
  }

  ensureStudioDirs();

  // Check active GPU lock (and auto-clean if stale)
  const currentLock = readActiveLock();
  if (currentLock.locked) {
    return NextResponse.json(
      {
        success: false,
        error: `توجد عملية تدريب نشطة حالياً (${currentLock.jobId}). انتظر اكتمالها أو قم بإلغائها أولاً.`,
        activeJobId: currentLock.jobId,
      },
      { status: 409 }
    );
  }

  let jobDir = '';
  let lockAcquired = false;

  try {
    const form = await req.formData();
    const modelKey = String(form.get('modelKey') || '');
    const epochsRaw = parseInt(String(form.get('epochs') || '15'), 10);
    const epochs = Math.min(30, Math.max(5, Number.isFinite(epochsRaw) ? epochsRaw : 15));
    const useReplay = String(form.get('useReplay') ?? 'true') !== 'false';
    const batchNotes = String(form.get('batchNotes') || '').slice(0, 2000);
    const manifestRaw = String(form.get('manifest') || '[]');

    if (!isValidModelKey(modelKey)) {
      return NextResponse.json({ success: false, error: 'النموذج المختار غير صالح' }, { status: 400 });
    }

    let manifest: Array<{
      fileField: string;
      originalName?: string;
      notes?: string;
      isNegative?: boolean;
      boxes?: Array<{ classId: number; x: number; y: number; width: number; height: number }>;
    }> = [];

    try {
      manifest = JSON.parse(manifestRaw);
    } catch {
      return NextResponse.json({ success: false, error: 'صيغة بيانات الصور غير صالحة' }, { status: 400 });
    }

    if (!Array.isArray(manifest) || manifest.length === 0 || manifest.length > 30) {
      return NextResponse.json(
        { success: false, error: 'يجب رفع ما بين صورة واحدة و30 صورة في الدفعة الواحدة' },
        { status: 400 }
      );
    }

    const validClassIds = new Set(MODEL_DEFS[modelKey].classes.map(c => c.id));

    // Validate all samples before creating job directory
    const parsedSamples: Array<{
      buf: Buffer;
      ext: '.jpg' | '.png' | '.webp';
      originalName: string;
      notes: string;
      isNegative: boolean;
      boxes: Array<{ classId: number; x: number; y: number; width: number; height: number }>;
    }> = [];

    let totalBytes = 0;
    for (let i = 0; i < manifest.length; i++) {
      const item = manifest[i];
      const file = form.get(item.fileField) as File | null;
      if (!file || typeof file.arrayBuffer !== 'function') {
        return NextResponse.json({ success: false, error: `الملف مفقود للعنصر رقم ${i + 1}` }, { status: 400 });
      }
      const buf = Buffer.from(await file.arrayBuffer());
      if (buf.length === 0 || buf.length > 10 * 1024 * 1024) {
        return NextResponse.json({ success: false, error: `حجم الصورة ${file.name} يتجاوز الحد المسموح (10MB)` }, { status: 400 });
      }
      totalBytes += buf.length;
      if (totalBytes > 80 * 1024 * 1024) {
        return NextResponse.json({ success: false, error: 'إجمالي حجم الدفعة يتجاوز 80MB' }, { status: 400 });
      }
      const ext = detectImageExtension(buf);
      if (!ext) {
        return NextResponse.json({ success: false, error: `الصيغة غير مدعومة للصورة ${file.name} (يقبل JPG/PNG/WebP فقط)` }, { status: 400 });
      }

      const isNegative = Boolean(item.isNegative);
      const rawBoxes = Array.isArray(item.boxes) ? item.boxes : [];
      if (!isNegative && rawBoxes.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error: `الصورة "${item.originalName || file.name}" بدون مربعات تحديد. ارسم مربعاً واحداً على الأقل أو فعّل خيار "صورة سلبية".`,
          },
          { status: 400 }
        );
      }

      const cleanBoxes = rawBoxes.map(b => {
        const classId = Number(b.classId);
        if (!validClassIds.has(classId)) {
          throw new Error(`تصنيف غير صالح (${classId}) للصورة ${file.name}`);
        }
        return {
          classId,
          x: Math.max(0, Math.min(100, Number(b.x))),
          y: Math.max(0, Math.min(100, Number(b.y))),
          width: Math.max(0.5, Math.min(100, Number(b.width))),
          height: Math.max(0.5, Math.min(100, Number(b.height))),
        };
      });

      parsedSamples.push({
        buf,
        ext,
        originalName: String(item.originalName || file.name || `sample_${i + 1}${ext}`).slice(0, 120),
        notes: String(item.notes || '').slice(0, 1000),
        isNegative,
        boxes: cleanBoxes,
      });
    }

    // Acquire atomic lock before spawning
    const jobId = `job_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    try {
      const fd = fs.openSync(LOCK_FILE, 'wx');
      fs.writeSync(fd, JSON.stringify({ jobId, pid: process.pid, createdAt: new Date().toISOString() }));
      fs.closeSync(fd);
      lockAcquired = true;
    } catch {
      return NextResponse.json({ success: false, error: 'توجد عملية تدريب نشطة بالفعل' }, { status: 409 });
    }

    jobDir = path.join(JOBS_DIR, jobId);
    const samplesDir = path.join(jobDir, 'samples');
    fs.mkdirSync(samplesDir, { recursive: true });

    for (let i = 0; i < parsedSamples.length; i++) {
      const s = parsedSamples[i];
      const baseName = `img_${String(i + 1).padStart(3, '0')}`;
      const fileName = `${baseName}${s.ext}`;
      fs.writeFileSync(path.join(samplesDir, fileName), s.buf);
      fs.writeFileSync(
        path.join(samplesDir, `${baseName}.meta.json`),
        JSON.stringify(
          {
            fileName,
            originalName: s.originalName,
            notes: s.notes,
            isNegative: s.isNegative,
            boxes: s.boxes,
          },
          null,
          2
        ),
        'utf8'
      );
    }

    const jobMeta = {
      jobId,
      modelKey,
      modelTitleAr: MODEL_DEFS[modelKey].titleAr,
      status: 'queued',
      epochs,
      useReplay,
      batchNotes,
      sampleCount: parsedSamples.length,
      negativeCount: parsedSamples.filter(s => s.isNegative).length,
      boxCount: parsedSamples.reduce((acc, s) => acc + s.boxes.length, 0),
      notesCount: parsedSamples.filter(s => s.notes.trim().length > 0).length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pid: null as number | null,
    };

    const jobPath = path.join(jobDir, 'job.json');
    fs.writeFileSync(jobPath, JSON.stringify(jobMeta, null, 2), 'utf8');

    const logPath = path.join(jobDir, 'train.log');
    const logFd = fs.openSync(logPath, 'a');

    const child = spawn(PYTHON_BIN, ['-u', TRAIN_SCRIPT, '--job-id', jobId], {
      cwd: SAQR_ROOT,
      detached: true,
      stdio: ['ignore', logFd, logFd],
    });
    fs.closeSync(logFd);

    if (!child.pid) {
      throw new Error('تعذر تشغيل سكربت التدريب على المعالج الرسومي');
    }

    jobMeta.pid = child.pid;
    fs.writeFileSync(jobPath, JSON.stringify(jobMeta, null, 2), 'utf8');
    fs.writeFileSync(LOCK_FILE, JSON.stringify({ jobId, pid: child.pid, createdAt: jobMeta.createdAt }));
    child.unref();

    return NextResponse.json({ success: true, jobId, job: jobMeta }, { status: 202 });
  } catch (err: any) {
    if (lockAcquired && fs.existsSync(LOCK_FILE)) {
      try { fs.unlinkSync(LOCK_FILE); } catch {}
    }
    if (jobDir && fs.existsSync(jobDir)) {
      try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch {}
    }
    return NextResponse.json(
      { success: false, error: err.message || 'فشل إنشاء مهمة التدريب' },
      { status: 400 }
    );
  }
}
