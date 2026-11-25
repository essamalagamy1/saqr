import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import {
  CV_DIR,
  MANIFEST_FILE,
  MODEL_DEFS,
  MODELS_DIR,
  listBackupsForModel,
  readActiveLock,
  requireAuth,
  sha256File,
} from '@/lib/training-server';

function countFiles(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  return fs.readdirSync(dirPath).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f)).length;
}

function readMetrics(cvDir: string) {
  const metricsFile = path.join(CV_DIR, cvDir, 'results', 'evaluation_metrics.json');
  if (!fs.existsSync(metricsFile)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(metricsFile, 'utf8'));
    if (raw.overall) {
      return {
        map50: raw.overall.map50 ?? null,
        precision: raw.overall.precision ?? null,
        recall: raw.overall.recall ?? null,
      };
    }
    return {
      map50: raw.map50 ?? null,
      precision: raw.precision ?? null,
      recall: raw.recall ?? null,
    };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: 'غير مصرح بالدخول' }, { status: 401 });
  }

  let manifest: any = { models: {} };
  if (fs.existsSync(MANIFEST_FILE)) {
    try {
      manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
    } catch {}
  }

  const models = Object.values(MODEL_DEFS).map(def => {
    const onnxPath = path.join(MODELS_DIR, def.onnxName);
    const exists = fs.existsSync(onnxPath);
    const stat = exists ? fs.statSync(onnxPath) : null;
    const sha256 = exists ? sha256File(onnxPath) : '';
    const trainCount = countFiles(path.join(CV_DIR, def.cvDir, 'dataset', 'images', 'train'));
    const valCount = countFiles(path.join(CV_DIR, def.cvDir, 'dataset', 'images', 'val'));
    const studioEntry = manifest?.models?.[def.key] || null;
    const backups = listBackupsForModel(def.key);

    return {
      ...def,
      onnxExists: exists,
      onnxSizeMB: stat ? parseFloat((stat.size / 1024 / 1024).toFixed(2)) : 0,
      updatedAt: studioEntry?.updatedAt || (stat ? stat.mtime.toISOString() : null),
      sha256Short: sha256 ? sha256.slice(0, 12) : '',
      sha256,
      datasetCounts: { train: trainCount, val: valCount },
      metrics: readMetrics(def.cvDir),
      studioTrained: Boolean(studioEntry?.studioTrained),
      lastJobId: studioEntry?.lastJobId || null,
      canRollback: backups.length > 0,
    };
  });

  return NextResponse.json({
    success: true,
    models,
    activeLock: readActiveLock(),
  });
}
