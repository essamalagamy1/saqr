import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { NextRequest } from 'next/server';

const execFileAsync = promisify(execFile);

export const SAQR_ROOT = process.env.SAQR_ROOT || path.resolve(process.cwd(), '..', '..');
export const STUDIO_DIR = path.join(SAQR_ROOT, 'storage', 'training_studio');
export const JOBS_DIR = path.join(STUDIO_DIR, 'jobs');
export const BACKUPS_DIR = path.join(STUDIO_DIR, 'backups');
export const LOCK_FILE = path.join(STUDIO_DIR, 'active.lock');
export const MODELS_DIR = path.join(SAQR_ROOT, 'apps', 'desktop', 'models');
export const MANIFEST_FILE = path.join(MODELS_DIR, 'studio_manifest.json');
export const RELOAD_SIGNAL = path.join(MODELS_DIR, '.reload_signal');
export const CV_DIR = path.join(SAQR_ROOT, 'computer-vision');
export const PYTHON_BIN = path.join(SAQR_ROOT, '.venv', 'bin', 'python');
export const TRAIN_SCRIPT = path.join(SAQR_ROOT, 'scripts', 'train_custom_studio.py');
export const INFER_HELPER = path.join(SAQR_ROOT, 'scripts', 'studio_infer.js');
const GO_API_BASE = process.env.INTERNAL_API_URL || 'http://127.0.0.1:8080/api/v1';

export type ModelKey = 'face_mask' | 'gloves' | 'phone';

export interface ModelClassDef {
  id: number;
  name: string;
  labelAr: string;
  color: string;
}

export interface ModelDef {
  key: ModelKey;
  titleAr: string;
  enName: string;
  descriptionAr: string;
  cvDir: string;
  onnxName: string;
  classes: ModelClassDef[];
}

export const MODEL_DEFS: Record<ModelKey, ModelDef> = {
  face_mask: {
    key: 'face_mask',
    titleAr: 'كشف الكمامة والالتزام الصحي',
    enName: 'YOLO26 Face Mask',
    descriptionAr: 'يميز بين ارتداء الكمامة الصحيحة، عدم ارتداء الكمامة، أو ارتدائها بشكل خاطئ.',
    cvDir: 'face_mask',
    onnxName: 'face_mask.onnx',
    classes: [
      { id: 0, name: 'with_mask', labelAr: 'كمامة صحيحة', color: '#10b981' },
      { id: 1, name: 'without_mask', labelAr: 'بدون كمامة', color: '#ef4444' },
      { id: 2, name: 'mask_weared_incorrect', labelAr: 'ارتداء خاطئ', color: '#f59e0b' },
    ],
  },
  gloves: {
    key: 'gloves',
    titleAr: 'كشف القفازات والأيدي المكشوفة',
    enName: 'YOLO26 Gloves & Hands',
    descriptionAr: 'يميز بين ارتداء قفازات الاستخدام الواحد ولمس الأغذية بالأيدي المكشوفة.',
    cvDir: 'gloves',
    onnxName: 'gloves.onnx',
    classes: [
      { id: 0, name: 'gloves', labelAr: 'قفازات مطابقة', color: '#10b981' },
      { id: 1, name: 'bare_hand', labelAr: 'يد بدون قفازات', color: '#ef4444' },
    ],
  },
  phone: {
    key: 'phone',
    titleAr: 'كشف استخدام الهاتف المحمول',
    enName: 'YOLO26 Mobile Phone',
    descriptionAr: 'يرصد استخدام الهاتف المحمول في أيدي العاملين أثناء ساعات العمل.',
    cvDir: 'phone_detection',
    onnxName: 'phone.onnx',
    classes: [
      { id: 0, name: 'cell_phone', labelAr: 'استخدام هاتف', color: '#a855f7' },
    ],
  },
};

export function ensureStudioDirs() {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

export function isValidModelKey(key: string): key is ModelKey {
  return key === 'face_mask' || key === 'gloves' || key === 'phone';
}

export function sanitizeId(id: string): string | null {
  if (!id || !/^[a-zA-Z0-9_-]{4,64}$/.test(id)) return null;
  return id;
}

export function sha256File(filePath: string): string {
  if (!fs.existsSync(filePath)) return '';
  const hash = crypto.createHash('sha256');
  const buf = fs.readFileSync(filePath);
  hash.update(buf);
  return hash.digest('hex');
}

export function isPidAlive(pid: number): boolean {
  if (!pid || !Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readActiveLock(): { locked: boolean; jobId?: string; pid?: number } {
  if (!fs.existsSync(LOCK_FILE)) return { locked: false };
  try {
    const raw = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
    if (raw.pid && isPidAlive(Number(raw.pid))) {
      return { locked: true, jobId: raw.jobId, pid: Number(raw.pid) };
    }
    // Stale lock from crashed process — clean it up automatically
    fs.unlinkSync(LOCK_FILE);
    return { locked: false };
  } catch {
    return { locked: false };
  }
}

export function reconcileJobState(jobPath: string): any {
  const job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
  const runningStates = new Set(['queued', 'preparing', 'training', 'exporting', 'verifying']);
  if (runningStates.has(job.status) && job.pid && !isPidAlive(Number(job.pid))) {
    // Check if completed proof was actually written right before exit
    const proofPath = path.join(path.dirname(jobPath), 'proof.json');
    if (fs.existsSync(proofPath)) {
      job.status = 'completed';
    } else {
      job.status = 'failed';
      job.error = job.error || 'توقفت عملية التدريب بشكل غير متوقع';
    }
    job.updatedAt = new Date().toISOString();
    fs.writeFileSync(jobPath, JSON.stringify(job, null, 2), 'utf8');
  }
  return job;
}

export function parseTrainLogProgress(logText: string, totalEpochs: number, status: string) {
  let currentEpoch = 0;
  let lastBoxLoss: number | null = null;
  let lastClsLoss: number | null = null;

  // Strip ANSI escape sequences and split carriage-return progress lines
  const cleanText = logText.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  const lines = cleanText.split(/[\r\n]+/);
  for (const line of lines) {
    // Ultralytics training lines typically look like: "      1/15      1.32G      0.885     0.6744 ..."
    const m = line.match(/^\s*(\d+)\/(\d+)\s+[\d.]+G\s+([\d.]+)\s+([\d.]+)/i);
    if (m) {
      const ep = parseInt(m[1], 10);
      const tot = parseInt(m[2], 10);
      if (tot === totalEpochs && ep >= 1 && ep <= totalEpochs) {
        currentEpoch = Math.max(currentEpoch, ep);
        lastBoxLoss = parseFloat(m[3]);
        lastClsLoss = parseFloat(m[4]);
      }
    }
  }

  let percent = 0;
  if (status === 'completed') percent = 100;
  else if (status === 'verifying') percent = 96;
  else if (status === 'exporting') percent = 90;
  else if (status === 'preparing' || status === 'queued') percent = 8;
  else if (status === 'training') {
    const ratio = totalEpochs > 0 ? currentEpoch / totalEpochs : 0;
    percent = Math.min(88, Math.max(12, Math.round(12 + ratio * 76)));
  }

  const dedupedLines = lines.map(l => l.trimEnd()).filter(l => l.trim().length > 0);
  return {
    currentEpoch,
    totalEpochs,
    percent,
    lastBoxLoss,
    lastClsLoss,
    tailLines: dedupedLines.slice(-60),
  };
}

export async function requireAuth(req: NextRequest, allowQueryToken = false): Promise<{ ok: boolean; companyId?: string }> {
  let token = '';
  const authHeader = req.headers.get('authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (allowQueryToken) {
    token = req.nextUrl.searchParams.get('token') || '';
  }

  if (!token || token.length < 16) {
    return { ok: false };
  }

  try {
    const res = await fetch(`${GO_API_BASE}/company/current`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false };
    const json = await res.json();
    const companyId = json?.data?.id || json?.data?.company_id || '';
    return { ok: true, companyId };
  } catch {
    return { ok: false };
  }
}

export async function runStudioInfer(args: string[]): Promise<any> {
  const { stdout } = await execFileAsync('node', [INFER_HELPER, ...args], {
    cwd: SAQR_ROOT,
    maxBuffer: 12 * 1024 * 1024,
  });
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}

export function listBackupsForModel(modelKey: ModelKey): string[] {
  if (!fs.existsSync(BACKUPS_DIR)) return [];
  return fs
    .readdirSync(BACKUPS_DIR)
    .filter(d => d.startsWith(`${modelKey}_`) && fs.statSync(path.join(BACKUPS_DIR, d)).isDirectory())
    .sort((a, b) => {
      const mA = fs.statSync(path.join(BACKUPS_DIR, a)).mtimeMs;
      const mB = fs.statSync(path.join(BACKUPS_DIR, b)).mtimeMs;
      return mB - mA;
    });
}
