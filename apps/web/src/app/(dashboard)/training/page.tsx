'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  BrainCircuit,
  ChefHat,
  ShieldCheck,
  Smartphone,
  Upload,
  Wand2,
  Trash2,
  Play,
  Square,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RotateCcw,
  FileText,
  Sparkles,
  FlaskConical,
  ArrowLeftRight,
  Cpu,
  Clock,
  Layers,
  Ban,
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { AnnotationCanvas, StudioBox, ClassMeta } from '@/components/training/AnnotationCanvas';
import { fetchAuthorizedImageUrl, trainingFetch } from '@/lib/training-api';

interface StudioModelInfo {
  key: 'face_mask' | 'gloves' | 'phone';
  titleAr: string;
  enName: string;
  descriptionAr: string;
  onnxName: string;
  onnxExists: boolean;
  onnxSizeMB: number;
  updatedAt: string | null;
  sha256Short: string;
  datasetCounts: { train: number; val: number };
  metrics: { map50: number | null; precision: number | null; recall: number | null } | null;
  studioTrained: boolean;
  canRollback: boolean;
  classes: ClassMeta[];
}

interface DraftSample {
  localId: string;
  file: File;
  previewUrl: string;
  notes: string;
  isNegative: boolean;
  boxes: StudioBox[];
  prelabeling?: boolean;
}

interface ProofDetection {
  classId: number;
  className: string;
  label: string;
  color: string;
  score: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export default function TrainingStudioPage() {
  const [models, setModels] = useState<StudioModelInfo[]>([]);
  const [selectedModelKey, setSelectedModelKey] = useState<'face_mask' | 'gloves' | 'phone'>('face_mask');
  const [loadingModels, setLoadingModels] = useState(true);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);

  // Samples & Annotation state
  const [samples, setSamples] = useState<DraftSample[]>([]);
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null);
  const [activeClassId, setActiveClassId] = useState<number>(1);
  const [batchNotes, setBatchNotes] = useState('');
  const [epochs, setEpochs] = useState<number>(15);
  const [useReplay, setUseReplay] = useState<boolean>(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Training job & progress state
  const [jobs, setJobs] = useState<any[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJobData, setActiveJobData] = useState<any>(null);
  const [startingJob, setStartingJob] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [proofImageUrls, setProofImageUrls] = useState<Record<string, string>>({});

  // Live unseen image tester
  const [testImageFile, setTestImageFile] = useState<File | null>(null);
  const [testImagePreview, setTestImagePreview] = useState<string>('');
  const [testMode, setTestMode] = useState<'raw' | 'prod'>('raw');
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  const showToast = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 5000);
  }, []);

  const loadModelsAndJobs = useCallback(async () => {
    try {
      const [mRes, jRes] = await Promise.all([
        trainingFetch<{ models: StudioModelInfo[]; activeLock: any }>('/api/training/models'),
        trainingFetch<{ jobs: any[]; activeLock: any }>('/api/training/jobs'),
      ]);
      setModels(mRes.models || []);
      setJobs(jRes.jobs || []);
      if (jRes.activeLock?.locked && jRes.activeLock.jobId) {
        setActiveJobId(jRes.activeLock.jobId);
      }
    } catch (err: any) {
      showToast(err.message || 'تعذر تحميل بيانات النماذج', 'err');
    } finally {
      setLoadingModels(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadModelsAndJobs();
  }, [loadModelsAndJobs]);

  const selectedModel = models.find(m => m.key === selectedModelKey) || models[0];
  const selectedSample = samples.find(s => s.localId === selectedSampleId) || samples[0] || null;

  // Reset active class when switching models
  useEffect(() => {
    if (!selectedModel) return;
    const defaultViolationClass = selectedModel.classes.find(c => c.id === 1) || selectedModel.classes[0];
    if (defaultViolationClass) {
      setActiveClassId(defaultViolationClass.id);
    }
  }, [selectedModelKey, selectedModel?.classes?.length]);

  // Poll active training job every 1.5s
  useEffect(() => {
    if (!activeJobId) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await trainingFetch<any>(`/api/training/jobs/${activeJobId}`);
        if (cancelled) return;
        setActiveJobData(res);

        if (res.proof?.samples) {
          const urls: Record<string, string> = {};
          await Promise.all(
            res.proof.samples.map(async (s: any) => {
              const u = await fetchAuthorizedImageUrl(
                `/api/training/jobs/${activeJobId}/image?name=${encodeURIComponent(s.fileName)}`
              );
              if (u) urls[s.fileName] = u;
            })
          );
          if (!cancelled) setProofImageUrls(urls);
        }

        const st = res.job?.status;
        if (st === 'completed' || st === 'failed') {
          loadModelsAndJobs();
          if (st === 'completed') {
            showToast('اكتمل التدريب الفعلي وتم تفعيل النموذج المحدّث تلقائياً!');
          }
          return;
        }
      } catch {
        // Retry on transient poll error
      }
      if (!cancelled) {
        setTimeout(poll, 1500);
      }
    };

    poll();
    return () => {
      cancelled = true;
    };
  }, [activeJobId, loadModelsAndJobs, showToast]);

  const handleFilesSelected = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const existingCount = samples.length;
    const remaining = Math.max(0, 30 - existingCount);
    const picked = Array.from(files).slice(0, remaining);

    if (files.length > remaining) {
      showToast(`الحد الأقصى 30 صورة في الدفعة؛ تم قبول ${picked.length} صورة.`, 'err');
    }

    const created: DraftSample[] = picked
      .filter(f => /\.(jpe?g|png|webp)$/i.test(f.name) || f.type.startsWith('image/'))
      .map((file, idx) => ({
        localId: `smp_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        notes: '',
        isNegative: false,
        boxes: [],
      }));

    if (created.length === 0) return;
    setSamples(prev => [...prev, ...created]);
    if (!selectedSampleId) setSelectedSampleId(created[0].localId);
  };

  const updateSample = (localId: string, updater: (prev: DraftSample) => DraftSample) => {
    setSamples(prev => prev.map(s => (s.localId === localId ? updater(s) : s)));
  };

  const removeSample = (localId: string) => {
    setSamples(prev => {
      const target = prev.find(s => s.localId === localId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      const next = prev.filter(s => s.localId !== localId);
      if (selectedSampleId === localId) {
        setSelectedSampleId(next[0]?.localId || null);
      }
      return next;
    });
  };

  const handlePrelabelSample = async (sample: DraftSample) => {
    updateSample(sample.localId, s => ({ ...s, prelabeling: true }));
    try {
      const form = new FormData();
      form.append('modelKey', selectedModelKey);
      form.append('image', sample.file);
      const res = await trainingFetch<any>('/api/training/prelabel', {
        method: 'POST',
        body: form,
      });

      const mapped: StudioBox[] = (res.detections || []).map((d: any, idx: number) => ({
        id: `pre_${Date.now()}_${idx}`,
        classId: Number(d.classId ?? 0),
        x: d.x,
        y: d.y,
        width: d.width,
        height: d.height,
        score: d.score,
      }));

      updateSample(sample.localId, s => ({
        ...s,
        isNegative: false,
        boxes: mapped,
        prelabeling: false,
      }));

      showToast(
        mapped.length > 0
          ? `تم رصد ${mapped.length} عنصر مبدئياً — يمكنك تعديلها أو تأكيدها`
          : 'لم يرصد النموذج الحالي شيئاً في الصورة — ارسم المربع يدوياً أو علّمها كصورة سلبية'
      );
    } catch (err: any) {
      updateSample(sample.localId, s => ({ ...s, prelabeling: false }));
      showToast(err.message || 'فشل الرصد التلقائي', 'err');
    }
  };

  const allSamplesValid =
    samples.length > 0 && samples.every(s => s.isNegative || s.boxes.length > 0);
  const isJobRunning = Boolean(
    activeJobData?.job &&
      ['queued', 'preparing', 'training', 'exporting', 'verifying'].includes(activeJobData.job.status)
  );

  const handleStartTraining = async () => {
    if (!allSamplesValid) {
      showToast('كل صورة مرفوعة يجب أن تحتوي على مربع تحديد واحد على الأقل أو تُعلّم كصورة سلبية.', 'err');
      return;
    }

    setStartingJob(true);
    try {
      const form = new FormData();
      form.append('modelKey', selectedModelKey);
      form.append('epochs', String(epochs));
      form.append('useReplay', String(useReplay));
      form.append('batchNotes', batchNotes);

      const manifest = samples.map((s, idx) => {
        const field = `file_${idx}`;
        form.append(field, s.file);
        return {
          fileField: field,
          originalName: s.file.name,
          notes: s.notes,
          isNegative: s.isNegative,
          boxes: s.boxes.map(b => ({
            classId: b.classId,
            x: b.x,
            y: b.y,
            width: b.width,
            height: b.height,
          })),
        };
      });
      form.append('manifest', JSON.stringify(manifest));

      const res = await trainingFetch<{ jobId: string; job: any }>('/api/training/jobs', {
        method: 'POST',
        body: form,
      });

      setActiveJobData({ job: res.job, progress: { percent: 8, currentEpoch: 0, totalEpochs: epochs, tailLines: [] }, proof: null });
      setActiveJobId(res.jobId);
      showToast('بدأ التدريب الفعلي على كارت الشاشة (Quadro P2000 GPU)...');
    } catch (err: any) {
      showToast(err.message || 'تعذر بدء التدريب', 'err');
    } finally {
      setStartingJob(false);
    }
  };

  const handleCancelJob = async () => {
    if (!activeJobId) return;
    try {
      await trainingFetch(`/api/training/jobs/${activeJobId}/cancel`, { method: 'POST' });
      showToast('تم إيقاف مهمة التدريب');
      loadModelsAndJobs();
    } catch (err: any) {
      showToast(err.message || 'فشل الإلغاء', 'err');
    }
  };

  const handleRollback = async (modelKey: 'face_mask' | 'gloves' | 'phone') => {
    setRollingBack(true);
    try {
      const res = await trainingFetch<any>('/api/training/rollback', {
        method: 'POST',
        body: JSON.stringify({ modelKey }),
      });
      showToast(`تم استرجاع النسخة السابقة للنموذج بنجاح (${res.sha256Short})`);
      loadModelsAndJobs();
    } catch (err: any) {
      showToast(err.message || 'فشل الاسترجاع', 'err');
    } finally {
      setRollingBack(false);
    }
  };

  const handleRunLiveTest = async () => {
    if (!testImageFile) return;
    setTestLoading(true);
    setTestResult(null);
    try {
      const form = new FormData();
      form.append('modelKey', selectedModelKey);
      form.append('mode', testMode);
      if (testMode === 'raw') {
        form.append('conf', '0.25');
      }
      form.append('image', testImageFile);
      const res = await trainingFetch<any>('/api/training/test', {
        method: 'POST',
        body: form,
      });
      setTestResult(res);
    } catch (err: any) {
      showToast(err.message || 'فشل اختبار الصورة', 'err');
    } finally {
      setTestLoading(false);
    }
  };

  const currentStep = activeJobData?.proof
    ? 4
    : isJobRunning
      ? 3
      : samples.length > 0
        ? 2
        : 1;

  return (
    <div className="space-y-6 pb-12">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-5 left-5 z-50 flex items-center gap-2 rounded-xl border px-4 py-3 text-xs font-bold shadow-2xl backdrop-blur-md ${
            toast.type === 'ok'
              ? 'border-emerald-500/40 bg-emerald-950/90 text-emerald-200'
              : 'border-rose-500/40 bg-rose-950/90 text-rose-200'
          }`}
        >
          {toast.type === 'ok' ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <AlertCircle className="h-4 w-4 text-rose-400" />}
          <span>{toast.msg}</span>
        </div>
      )}

      {/* Header + 4-Step Progress Indicator */}
      <div className="rounded-xl border border-slate-800/90 bg-[#0d131f] p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-sky-400" />
                <span>مختبر التدريب المخصص للنماذج (YOLO26 GPU Studio)</span>
              </h1>
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px] px-2.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                <Cpu className="h-3.5 w-3.5" />
                NVIDIA Quadro P2000 • CUDA
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              ارفع صورك الحقيقية، حدّد العناصر واكتب ملاحظاتك، درّب النموذج فعلياً على GPU، وتأكد من النتيجة بمقارنة قبل وبعد التدريب.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {[
              { step: 1, title: '1. اختيار النموذج' },
              { step: 2, title: '2. الصور والملاحظات' },
              { step: 3, title: '3. التدريب الفعلي' },
              { step: 4, title: '4. الإثبات والاختبار' },
            ].map(item => (
              <div
                key={item.step}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition ${
                  currentStep === item.step
                    ? 'bg-sky-500/15 border-sky-500/50 text-sky-300'
                    : currentStep > item.step
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-slate-900/60 border-slate-800 text-slate-500'
                }`}
              >
                {item.title}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* STEP 1: Select One of the 3 Models */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <BrainCircuit className="h-4 w-4 text-sky-400" />
            <span>1. اختر النموذج المراد تدريبه (3 نماذج متاحة)</span>
          </h2>
        </div>

        {loadingModels ? (
          <div className="py-10 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
            <span>جاري قراءة حالة النماذج والأوزان الفعلية...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {models.map(model => {
              const Icon = model.key === 'face_mask' ? ChefHat : model.key === 'gloves' ? ShieldCheck : Smartphone;
              const isSelected = selectedModelKey === model.key;
              return (
                <div
                  key={model.key}
                  onClick={() => !isJobRunning && setSelectedModelKey(model.key)}
                  className={`rounded-xl border p-4 transition cursor-pointer flex flex-col justify-between ${
                    isSelected
                      ? 'border-sky-500 bg-sky-950/20 shadow-lg shadow-sky-950/30'
                      : 'border-slate-800 bg-[#0d131f] hover:border-slate-700'
                  } ${isJobRunning ? 'opacity-80 cursor-not-allowed' : ''}`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className={`p-2 rounded-lg ${isSelected ? 'bg-sky-500/20 text-sky-300' : 'bg-slate-800 text-slate-300'}`}>
                          <Icon className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="text-xs sm:text-sm font-bold text-white">{model.titleAr}</h3>
                          <span className="font-mono text-[10px] text-slate-400">{model.onnxName}</span>
                        </div>
                      </div>
                      {model.studioTrained && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                          مدرّب مخصص
                        </span>
                      )}
                    </div>

                    <p className="text-[11px] text-slate-400 leading-relaxed mb-3">{model.descriptionAr}</p>

                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {model.classes.map(cls => (
                        <span
                          key={cls.id}
                          className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold bg-slate-900 border border-slate-800 text-slate-200"
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cls.color }} />
                          <span>{cls.labelAr}</span>
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-800/80 space-y-2 text-[11px]">
                    <div className="flex items-center justify-between text-slate-400">
                      <span>البصمة SHA-256:</span>
                      <span className="font-mono text-sky-300">{model.sha256Short || '—'}</span>
                    </div>
                    <div className="flex items-center justify-between text-slate-400">
                      <span>الحجم / الداتاسيت:</span>
                      <span className="font-mono text-slate-200">
                        {model.onnxSizeMB} MB • {model.datasetCounts.train} صورة
                      </span>
                    </div>
                    {model.metrics?.map50 && (
                      <div className="flex items-center justify-between text-slate-400">
                        <span>الدقة الحالية mAP@50:</span>
                        <span className="font-mono font-bold text-emerald-400">
                          {(model.metrics.map50 * 100).toFixed(1)}%
                        </span>
                      </div>
                    )}
                    {model.canRollback && (
                      <button
                        type="button"
                        disabled={rollingBack || isJobRunning}
                        onClick={e => {
                          e.stopPropagation();
                          handleRollback(model.key);
                        }}
                        className="w-full mt-1 flex items-center justify-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 px-2.5 py-1.5 text-[11px] font-bold text-amber-300 transition disabled:opacity-50 cursor-pointer"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>استرجاع النسخة السابقة</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* STEP 2: Upload Images + Interactive Bounding Box & Notes */}
      {selectedModel && (
        <section className="rounded-xl border border-slate-800/90 bg-[#0d131f] p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Upload className="h-4 w-4 text-sky-400" />
                <span>2. رفع الصور وتحديد العناصر وكتابة الملاحظات ({selectedModel.titleAr})</span>
              </h2>
              <p className="text-[11px] text-slate-400 mt-0.5">
                اسحب الماوس فوق الصورة لرسم مربع حول الهدف، أو فعّل &quot;صورة سلبية&quot; لتعليم النموذج تجاهل اللقطة.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={e => {
                  handleFilesSelected(e.target.files);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isJobRunning || samples.length >= 30}
                className="flex items-center gap-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 px-3.5 py-2 text-xs font-bold text-white transition disabled:opacity-50 cursor-pointer"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>رفع مجموعة صور ({samples.length}/30)</span>
              </button>
            </div>
          </div>

          {samples.length === 0 ? (
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                handleFilesSelected(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              className="rounded-xl border-2 border-dashed border-slate-700 hover:border-sky-500/60 bg-[#080c14] p-10 text-center cursor-pointer transition space-y-2"
            >
              <Upload className="h-8 w-8 text-sky-400 mx-auto" />
              <div className="text-sm font-bold text-slate-200">اسحب الصور هنا أو اضغط لاختيار مجموعة صور</div>
              <div className="text-xs text-slate-500">يدعم JPG و PNG و WebP (من صورة واحدة حتى 30 صورة في الدفعة)</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Filmstrip */}
              <div className="lg:col-span-3 space-y-2 max-h-[540px] overflow-y-auto pr-1">
                {samples.map((s, idx) => {
                  const isActive = selectedSample?.localId === s.localId;
                  const ready = s.isNegative || s.boxes.length > 0;
                  return (
                    <div
                      key={s.localId}
                      onClick={() => setSelectedSampleId(s.localId)}
                      className={`rounded-lg border p-2 flex items-center gap-2.5 cursor-pointer transition ${
                        isActive
                          ? 'border-sky-500 bg-sky-500/10'
                          : 'border-slate-800 bg-[#080c14] hover:border-slate-700'
                      }`}
                    >
                      <img
                        src={s.previewUrl}
                        alt={s.file.name}
                        className="w-14 h-11 rounded object-cover shrink-0 border border-slate-800"
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="text-[11px] font-bold text-slate-200 truncate">
                          #{idx + 1} {s.file.name}
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {s.isNegative ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                              سلبية
                            </span>
                          ) : s.boxes.length > 0 ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
                              {s.boxes.length} تحديد
                            </span>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                              يحتاج تحديد
                            </span>
                          )}
                          {s.notes.trim() && (
                            <FileText className="h-3 w-3 text-slate-400" aria-label="توجد ملاحظات" />
                          )}
                          {!ready && <AlertCircle className="h-3 w-3 text-amber-400" />}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          removeSample(s.localId);
                        }}
                        title="حذف الصورة"
                        className="p-1 text-slate-500 hover:text-rose-400 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Center Interactive Canvas */}
              {selectedSample && (
                <div className="lg:col-span-6 space-y-3">
                  {/* Canvas Toolbar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#080c14] p-2.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[11px] text-slate-400 ml-1">التصنيف النشط:</span>
                      {selectedModel.classes.map(cls => (
                        <button
                          key={cls.id}
                          type="button"
                          onClick={() => {
                            setActiveClassId(cls.id);
                            if (selectedSample.isNegative) {
                              updateSample(selectedSample.localId, s => ({ ...s, isNegative: false }));
                            }
                          }}
                          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-bold border transition cursor-pointer ${
                            activeClassId === cls.id && !selectedSample.isNegative
                              ? 'bg-slate-800 border-sky-500 text-white'
                              : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cls.color }} />
                          <span>{cls.labelAr}</span>
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={selectedSample.prelabeling}
                        onClick={() => handlePrelabelSample(selectedSample)}
                        className="flex items-center gap-1 rounded-md border border-indigo-500/40 bg-indigo-500/15 hover:bg-indigo-500/25 px-2.5 py-1 text-[11px] font-bold text-indigo-300 transition disabled:opacity-50 cursor-pointer"
                      >
                        {selectedSample.prelabeling ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Wand2 className="h-3 w-3" />
                        )}
                        <span>رصد تلقائي مبدئي</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          updateSample(selectedSample.localId, s => ({
                            ...s,
                            isNegative: !s.isNegative,
                          }))
                        }
                        className={`flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-bold transition cursor-pointer ${
                          selectedSample.isNegative
                            ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300'
                            : 'border-slate-700 bg-slate-900 text-slate-300 hover:text-white'
                        }`}
                      >
                        <Ban className="h-3 w-3" />
                        <span>صورة سلبية</span>
                      </button>
                    </div>
                  </div>

                  <AnnotationCanvas
                    imageUrl={selectedSample.previewUrl}
                    boxes={selectedSample.boxes}
                    classes={selectedModel.classes}
                    activeClassId={activeClassId}
                    isNegative={selectedSample.isNegative}
                    onAddBox={box =>
                      updateSample(selectedSample.localId, s => ({
                        ...s,
                        isNegative: false,
                        boxes: [...s.boxes, box],
                      }))
                    }
                    onRemoveBox={boxId =>
                      updateSample(selectedSample.localId, s => ({
                        ...s,
                        boxes: s.boxes.filter(b => b.id !== boxId),
                      }))
                    }
                  />
                </div>
              )}

              {/* Right Panel: Per-Image Notes & Box List */}
              {selectedSample && (
                <div className="lg:col-span-3 space-y-3">
                  <div className="rounded-lg border border-slate-800 bg-[#080c14] p-3 space-y-2">
                    <label className="block text-xs font-bold text-white">
                      ملاحظاتي على هذه الصورة
                    </label>
                    <textarea
                      rows={4}
                      value={selectedSample.notes}
                      onChange={e =>
                        updateSample(selectedSample.localId, s => ({ ...s, notes: e.target.value }))
                      }
                      placeholder="اكتب وصفاً أو ملاحظة (مثال: عامل بتيشرت أسود بدون قفازات، أو هذه صينية أكل وليست وجهاً)..."
                      className="w-full rounded-lg border border-slate-800 bg-[#0d131f] p-2.5 text-xs text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
                    />
                  </div>

                  <div className="rounded-lg border border-slate-800 bg-[#080c14] p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white">
                        المربعات المحددة ({selectedSample.boxes.length})
                      </span>
                      {selectedSample.boxes.length > 0 && (
                        <button
                          type="button"
                          onClick={() => updateSample(selectedSample.localId, s => ({ ...s, boxes: [] }))}
                          className="text-[10px] text-rose-400 hover:text-rose-300 cursor-pointer"
                        >
                          مسح الكل
                        </button>
                      )}
                    </div>

                    {selectedSample.boxes.length === 0 ? (
                      <p className="text-[11px] text-slate-500">
                        {selectedSample.isNegative
                          ? 'مُعلّمة كصورة سلبية (ملف تسمية فارغ لـ YOLO).'
                          : 'اسحب الماوس فوق الصورة لإضافة مربع تحديد.'}
                      </p>
                    ) : (
                      <div className="space-y-1.5 max-h-[210px] overflow-y-auto">
                        {selectedSample.boxes.map((b, i) => (
                          <div
                            key={b.id}
                            className="flex items-center justify-between gap-2 rounded border border-slate-800 bg-[#0d131f] px-2 py-1.5 text-[11px]"
                          >
                            <select
                              value={b.classId}
                              onChange={e => {
                                const cid = Number(e.target.value);
                                updateSample(selectedSample.localId, s => ({
                                  ...s,
                                  boxes: s.boxes.map(item => (item.id === b.id ? { ...item, classId: cid } : item)),
                                }));
                              }}
                              className="bg-transparent text-slate-200 font-semibold focus:outline-none cursor-pointer"
                            >
                              {selectedModel.classes.map(cls => (
                                <option key={cls.id} value={cls.id} className="bg-slate-900">
                                  #{i + 1} {cls.labelAr}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() =>
                                updateSample(selectedSample.localId, s => ({
                                  ...s,
                                  boxes: s.boxes.filter(item => item.id !== b.id),
                                }))
                              }
                              className="text-rose-400 hover:text-rose-300 cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-slate-800 bg-[#080c14] p-3 space-y-1.5">
                    <label className="block text-[11px] font-bold text-slate-300">ملاحظات عامة للدفعة (اختياري)</label>
                    <input
                      type="text"
                      value={batchNotes}
                      onChange={e => setBatchNotes(e.target.value)}
                      placeholder="مثال: كاميرا المطبخ D8 - وردية المساء"
                      className="w-full rounded-lg border border-slate-800 bg-[#0d131f] px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* STEP 3: Real GPU Training Controls & Live Log Monitor */}
      <section className="rounded-xl border border-slate-800/90 bg-[#0d131f] p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="space-y-1">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Cpu className="h-4 w-4 text-emerald-400" />
              <span>3. تشغيل التدريب الحقيقي على GPU ومتابعة التنفيذ</span>
            </h2>
            <p className="text-[11px] text-slate-400">
              يتم تدريب <span className="font-mono text-sky-300">{selectedModelKey}</span> فعلياً باستخدام PyTorch + CUDA ثم تصدير ملف ONNX جديد وإعادة تحميله تلقائياً في الرصد المباشر.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-[#080c14] px-3 py-1.5 text-xs">
              <span className="text-slate-400">عدد الدورات (Epochs):</span>
              <input
                type="range"
                min={5}
                max={30}
                value={epochs}
                disabled={isJobRunning}
                onChange={e => setEpochs(Number(e.target.value))}
                className="w-24 accent-sky-500 cursor-pointer"
              />
              <span className="font-mono font-bold text-sky-400 w-6 text-center">{epochs}</span>
            </div>

            <label className="flex items-center gap-2 rounded-lg border border-slate-800 bg-[#080c14] px-3 py-1.5 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={useReplay}
                disabled={isJobRunning}
                onChange={e => setUseReplay(e.target.checked)}
                className="rounded accent-emerald-500"
              />
              <span>دمج عينات الداتاسيت الأساسية (منع النسيان)</span>
            </label>

            {isJobRunning ? (
              <button
                type="button"
                onClick={handleCancelJob}
                className="flex items-center gap-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 px-4 py-2 text-xs font-bold text-white transition cursor-pointer"
              >
                <Square className="h-3.5 w-3.5" />
                <span>إيقاف التدريب</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={!allSamplesValid || startingJob}
                onClick={handleStartTraining}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-950/50 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {startingJob ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                <span>بدء التدريب الفعلي على GPU</span>
              </button>
            )}
          </div>
        </div>

        {/* Live Progress & Terminal Output */}
        {activeJobData?.job && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-mono text-slate-400">{activeJobData.job.jobId}</span>
                <span
                  className={`px-2 py-0.5 rounded font-bold border ${
                    activeJobData.job.status === 'completed'
                      ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                      : activeJobData.job.status === 'failed'
                        ? 'border-rose-500/30 bg-rose-500/15 text-rose-300'
                        : 'border-sky-500/30 bg-sky-500/15 text-sky-300'
                  }`}
                >
                  {activeJobData.job.status}
                </span>
                {isJobRunning && <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />}
              </div>

              <div className="flex items-center gap-3 font-mono text-[11px] text-slate-300">
                <span>
                  Epoch: <strong>{activeJobData.progress?.currentEpoch || 0}/{activeJobData.job.epochs}</strong>
                </span>
                {activeJobData.progress?.lastBoxLoss !== null && activeJobData.progress?.lastBoxLoss !== undefined && (
                  <span>box_loss: <strong className="text-amber-300">{activeJobData.progress.lastBoxLoss}</strong></span>
                )}
                {activeJobData.progress?.lastClsLoss !== null && activeJobData.progress?.lastClsLoss !== undefined && (
                  <span>cls_loss: <strong className="text-sky-300">{activeJobData.progress.lastClsLoss}</strong></span>
                )}
                <span className="text-emerald-400 font-bold">{activeJobData.progress?.percent || 0}%</span>
              </div>
            </div>

            <div className="w-full h-2 rounded-full bg-slate-900 overflow-hidden border border-slate-800">
              <div
                className={`h-full transition-all duration-300 ${
                  activeJobData.job.status === 'failed' ? 'bg-rose-500' : 'bg-gradient-to-l from-emerald-500 to-sky-500'
                }`}
                style={{ width: `${activeJobData.progress?.percent || 0}%` }}
              />
            </div>

            {activeJobData.job.error && (
              <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 p-3 text-xs text-rose-200">
                {activeJobData.job.error}
              </div>
            )}

            <div
              dir="ltr"
              className="rounded-lg border border-slate-800 bg-[#050811] p-3 font-mono text-[11px] text-slate-300 max-h-48 overflow-y-auto space-y-0.5"
            >
              {(activeJobData.progress?.tailLines || []).length === 0 ? (
                <div className="text-slate-500">Waiting for CUDA training output...</div>
              ) : (
                activeJobData.progress.tailLines.map((line: string, i: number) => (
                  <div key={i} className="whitespace-pre-wrap break-all">
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </section>

      {/* STEP 4: Concrete Proof (Before vs After + Fingerprints + Epoch Curve) */}
      {activeJobData?.proof && (
        <section className="rounded-xl border border-emerald-500/30 bg-[#0d131f] p-5 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span>4. إثبات التدريب الفعلي ومقارنة النتائج (قبل التدريب vs بعد التدريب)</span>
              </h2>
              <p className="text-[11px] text-slate-400 mt-0.5">
                مقارنة مباشرة على نفس الصور المرفوعة بين أوزان النموذج القديمة والأوزان الجديدة بعد التصدير إلى ONNX.
              </p>
            </div>
          </div>

          {/* Cryptographic & Metric Proof Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="rounded-lg border border-slate-800 bg-[#080c14] p-3 space-y-1">
              <div className="text-slate-400 text-[11px]">بصمة النموذج قبل التدريب</div>
              <div className="font-mono text-xs text-slate-300">
                {(activeJobData.proof.onnxSha256Before || '').slice(0, 14) || '—'}
              </div>
            </div>
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/15 p-3 space-y-1">
              <div className="text-emerald-300 text-[11px]">بصمة النموذج الجديد (SHA-256)</div>
              <div className="font-mono text-xs font-bold text-emerald-400">
                {(activeJobData.proof.onnxSha256After || '').slice(0, 14) || '—'}
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#080c14] p-3 space-y-1">
              <div className="text-slate-400 text-[11px]">مؤشرات التحقق (mAP50 / Precision / Recall)</div>
              <div className="font-mono text-xs font-bold text-sky-300">
                {activeJobData.proof.metrics?.map50 !== undefined
                  ? `${(activeJobData.proof.metrics.map50 * 100).toFixed(1)}% / ${(activeJobData.proof.metrics.precision * 100).toFixed(1)}% / ${(activeJobData.proof.metrics.recall * 100).toFixed(1)}%`
                  : '—'}
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#080c14] p-3 space-y-1">
              <div className="text-slate-400 text-[11px]">تفعيل الرصد المباشر</div>
              <div className="text-xs font-bold text-emerald-400">تم التحديث وإرسال إشارة Hot-Reload</div>
            </div>
          </div>

          {/* Epoch Training Curve */}
          {Array.isArray(activeJobData.proof.epochHistory) && activeJobData.proof.epochHistory.length > 1 && (
            <div className="rounded-xl border border-slate-800 bg-[#080c14] p-4 space-y-2">
              <div className="text-xs font-bold text-slate-200">منحنى تحسن النموذج عبر الـ Epochs (mAP@50 و box_loss)</div>
              <div className="h-52 w-full" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={activeJobData.proof.epochHistory}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="epoch" stroke="#64748b" fontSize={11} />
                    <YAxis stroke="#64748b" fontSize={11} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0d131f', borderColor: '#1e293b', fontSize: 11 }}
                    />
                    <Line type="monotone" dataKey="map50" name="mAP@50" stroke="#10b981" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="box_loss" name="box_loss" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Side-by-Side Before vs After per Sample */}
          <div className="space-y-4">
            {(activeJobData.proof.samples || []).map((smp: any, idx: number) => {
              const imgSrc = proofImageUrls[smp.fileName] || '';
              return (
                <div key={smp.fileName} className="rounded-xl border border-slate-800 bg-[#080c14] p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-white">
                      <span>صورة #{idx + 1}: {smp.originalName}</span>
                      {smp.isNegative && (
                        <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px]">
                          صورة سلبية مستهدفة (0 مخالفات)
                        </span>
                      )}
                    </div>
                    {smp.notes && (
                      <span className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 rounded">
                        ملاحظتك: {smp.notes}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[
                      { title: 'قبل التدريب (Before)', data: smp.before, accent: 'text-slate-300' },
                      { title: 'بعد التدريب (After)', data: smp.after, accent: 'text-emerald-400' },
                    ].map(side => (
                      <div key={side.title} className="space-y-2">
                        <div className="flex items-center justify-between text-xs font-bold">
                          <span className={side.accent}>{side.title}</span>
                          <span className="font-mono text-[11px] text-slate-400">
                            {(side.data?.detections || []).length} رصد • {side.data?.inferenceMs || 0}ms
                          </span>
                        </div>
                        <div className="relative rounded-lg border border-slate-800 bg-black flex items-center justify-center p-1">
                          {imgSrc ? (
                            <div dir="ltr" className="relative inline-block">
                              <img
                                src={imgSrc}
                                alt={smp.originalName}
                                className="max-h-64 w-auto max-w-full rounded block"
                              />
                              {(side.data?.detections || []).map((b: ProofDetection, bi: number) => (
                                <div
                                  key={bi}
                                  className="absolute border-2 rounded-sm pointer-events-none"
                                  style={{
                                    left: `${b.x}%`,
                                    top: `${b.y}%`,
                                    width: `${b.width}%`,
                                    height: `${b.height}%`,
                                    borderColor: b.color,
                                    backgroundColor: `${b.color}20`,
                                  }}
                                >
                                  <span
                                    dir="rtl"
                                    className="absolute -top-5 left-0 bg-slate-950/95 text-white text-[10px] font-bold px-1.5 py-0.5 rounded border border-slate-700 whitespace-nowrap"
                                  >
                                    {b.label} {Math.round(b.score * 100)}%
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="py-12 text-xs text-slate-600">جاري تحميل الصورة...</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Live Unseen Image Tester */}
      <section className="rounded-xl border border-slate-800/90 bg-[#0d131f] p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-purple-400" />
              <span>اختبر النموذج المحدّث مباشرة على أي صورة جديدة</span>
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              ارفع صورة خارجية لم تدخل في التدريب للتأكد من أداء النموذج ({selectedModelKey}) بعد التحديث.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={testMode}
              onChange={e => setTestMode(e.target.value as 'raw' | 'prod')}
              className="rounded-lg border border-slate-700 bg-[#080c14] px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none cursor-pointer"
            >
              <option value="raw">فحص أوزان الموديل مباشرة (Raw ONNX)</option>
              <option value="prod">وضع الإنتاج الكامل (مع فلاتر الكاميرات)</option>
            </select>

            <label className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200 cursor-pointer">
              <Upload className="h-3.5 w-3.5" />
              <span>اختر صورة للاختبار</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (testImagePreview) URL.revokeObjectURL(testImagePreview);
                  setTestImageFile(f);
                  setTestImagePreview(URL.createObjectURL(f));
                  setTestResult(null);
                  e.target.value = '';
                }}
              />
            </label>

            <button
              type="button"
              disabled={!testImageFile || testLoading}
              onClick={handleRunLiveTest}
              className="flex items-center gap-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 px-4 py-1.5 text-xs font-bold text-white transition disabled:opacity-40 cursor-pointer"
            >
              {testLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowLeftRight className="h-3.5 w-3.5" />}
              <span>تشغيل الفحص الآن</span>
            </button>
          </div>
        </div>

        {testImagePreview && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            <div className="lg:col-span-8 rounded-xl border border-slate-800 bg-black p-2 flex items-center justify-center">
              <div dir="ltr" className="relative inline-block">
                <img
                  src={testImagePreview}
                  alt="Live test"
                  className="max-h-96 w-auto max-w-full rounded block"
                />
                {(testResult?.detections || []).map((b: ProofDetection, idx: number) => (
                  <div
                    key={idx}
                    className="absolute border-2 rounded-sm pointer-events-none"
                    style={{
                      left: `${b.x}%`,
                      top: `${b.y}%`,
                      width: `${b.width}%`,
                      height: `${b.height}%`,
                      borderColor: b.color,
                      backgroundColor: `${b.color}20`,
                    }}
                  >
                    <span
                      dir="rtl"
                      className="absolute -top-6 left-0 bg-slate-950/95 text-white text-[10px] font-bold px-2 py-0.5 rounded border border-slate-700 whitespace-nowrap"
                    >
                      {b.label} {Math.round(b.score * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-4 rounded-xl border border-slate-800 bg-[#080c14] p-4 space-y-2.5 text-xs">
              <div className="font-bold text-white">نتيجة الاختبار المباشر</div>
              {!testResult ? (
                <p className="text-slate-500">اضغط على &quot;تشغيل الفحص الآن&quot; لعرض النتائج.</p>
              ) : (
                <>
                  <div className="flex justify-between text-slate-400">
                    <span>زمن الاستدلال:</span>
                    <span className="font-mono text-sky-300">{testResult.inferenceMs} ms</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>بصمة الموديل:</span>
                    <span className="font-mono text-emerald-400">{testResult.modelSha256Short || '—'}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>العناصر المكتشفة:</span>
                    <span className="font-mono text-white font-bold">{testResult.detections.length}</span>
                  </div>
                  <div className="pt-2 border-t border-slate-800 space-y-1.5">
                    {testResult.detections.length === 0 ? (
                      <div className="text-slate-400">لم يتم العثور على عناصر مطابقة للعتبة المحددة.</div>
                    ) : (
                      testResult.detections.map((d: ProofDetection, i: number) => (
                        <div key={i} className="flex items-center justify-between rounded bg-slate-900 px-2.5 py-1.5">
                          <span className="font-semibold text-white">{d.label}</span>
                          <span className="font-mono text-emerald-400">{Math.round(d.score * 100)}%</span>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Training History Table */}
      <section className="rounded-xl border border-slate-800/90 bg-[#0d131f] p-5 space-y-3">
        <h2 className="text-sm font-bold text-white flex items-center gap-2">
          <Layers className="h-4 w-4 text-slate-400" />
          <span>سجل عمليات التدريب السابقة</span>
        </h2>

        {jobs.length === 0 ? (
          <p className="text-xs text-slate-500">لم يتم تشغيل أي عملية تدريب مخصصة بعد.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 px-3">المعرف</th>
                  <th className="py-2 px-3">النموذج</th>
                  <th className="py-2 px-3">الصور / التحديدات</th>
                  <th className="py-2 px-3">الدورات</th>
                  <th className="py-2 px-3">الحالة</th>
                  <th className="py-2 px-3">التاريخ</th>
                  <th className="py-2 px-3">الإثبات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {jobs.map(j => (
                  <tr key={j.jobId} className="hover:bg-slate-900/40">
                    <td className="py-2.5 px-3 font-mono text-[11px] text-slate-300">{j.jobId}</td>
                    <td className="py-2.5 px-3 font-semibold text-white">{j.modelTitleAr || j.modelKey}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-300">
                      {j.sampleCount} صورة • {j.boxCount} مربع
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-300">{j.epochs}</td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          j.status === 'completed'
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : j.status === 'failed'
                              ? 'bg-rose-500/15 text-rose-300'
                              : 'bg-sky-500/15 text-sky-300'
                        }`}
                      >
                        {j.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-400 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      <span>{new Date(j.createdAt).toLocaleString('ar-EG')}</span>
                    </td>
                    <td className="py-2.5 px-3">
                      <button
                        type="button"
                        onClick={() => setActiveJobId(j.jobId)}
                        className="text-sky-400 hover:text-sky-300 font-bold cursor-pointer"
                      >
                        عرض التقرير
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
