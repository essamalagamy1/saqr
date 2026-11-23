'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  ShieldCheck,
  Upload,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Sparkles,
  Sliders,
  RefreshCw,
  Image as ImageIcon,
  Zap,
  Eye,
  Info,
  ChevronRight,
  Code
} from 'lucide-react';

interface DetectionBox {
  id: string;
  label: string;
  arabicLabel: string;
  confidence: number;
  box: [number, number, number, number]; // [x1, y1, x2, y2] in normalized [0..1] or pixel coordinates
  color: string;
  category: 'mask' | 'gloves' | 'cap' | 'person' | 'other';
  isViolation?: boolean;
}

interface DetectionResult {
  detections: DetectionBox[];
  inferenceTimeMs: number;
  model: string;
  imageWidth: number;
  imageHeight: number;
  complianceSummary: {
    maskDetected: boolean;
    maskCount: number;
    glovesDetected: boolean;
    glovesCount: number;
    capDetected: boolean;
    capCount: number;
    overallCompliant: boolean;
  };
}

const PRESET_SAMPLES = [
  {
    name: 'طاهي كامل الالتزام (كمامة + كاب + قفازات)',
    url: 'https://images.unsplash.com/photo-1577219491135-ce391730fb2c?auto=format&fit=crop&w=800&q=80',
    desc: 'نموذج مطعم: ارتداء كامل لمهمات الوقاية'
  },
  {
    name: 'عامل تحضير طعام (كمامة فقط بدون قفازات)',
    url: 'https://images.unsplash.com/photo-1556910103-1c02745aae4d?auto=format&fit=crop&w=800&q=80',
    desc: 'نموذج مخالفة: عدم ارتداء قفازات أثناء التحضير'
  },
  {
    name: 'شيف بدون غطاء رأس وكمامة',
    url: 'https://images.unsplash.com/photo-1583394838336-acd977736f90?auto=format&fit=crop&w=800&q=80',
    desc: 'نموذج تنبيه: كشف مخالفات متعددة'
  }
];

export default function PpeTestPage() {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(0.25);
  const [selectedModel, setSelectedModel] = useState<string>('yolo26-ppe');
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<DetectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoveredBoxId, setHoveredBoxId] = useState<string | null>(null);
  const [showJson, setShowJson] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const imgElementRef = useRef<HTMLImageElement>(null);

  // Handle local file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (event) => {
      setSelectedImage(event.target?.result as string);
      setResult(null);
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  // Handle drag and drop
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (event) => {
      setSelectedImage(event.target?.result as string);
      setResult(null);
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  // Run AI Detection
  const runDetection = async () => {
    if (!selectedImage) return;

    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      if (imageFile) {
        formData.append('image', imageFile);
      } else {
        formData.append('imageUrl', selectedImage);
      }
      formData.append('threshold', String(confidenceThreshold));
      formData.append('model', selectedModel);

      const res = await fetch('/api/ppe/detect', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `فشل فحص الصورة (رمز الاستجابة: ${res.status})`);
      }

      const data = await res.json();
      setResult(data);
    } catch (err: any) {
      console.error('Inference error:', err);
      setError(err.message || 'حدث خطأ أثناء إجراء الفحص الذكي');
    } finally {
      setLoading(false);
    }
  };

  // Run automatically when image changes or when user clicks sample
  const selectPreset = (preset: typeof PRESET_SAMPLES[0]) => {
    setSelectedImage(preset.url);
    setImageFile(null);
    setResult(null);
    setError(null);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                مختبر الفحص الذكي لمهمات الوقاية (PPE Lab)
                <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-mono">
                  YOLO26 NMS-Free
                </span>
              </h1>
              <p className="text-sm text-slate-400">
                اختبار فوري للنماذج العصبية لرصد الكمامة (Mask)، القفازات (Gloves)، وغطاء الرأس (Cap / Hairnet)
              </p>
            </div>
          </div>
        </div>

        {/* Target Classes Badges */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-500/10 border border-emerald-500/25 text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
            الكمامة (Mask)
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-purple-500/10 border border-purple-500/25 text-purple-300">
            <span className="h-2 w-2 rounded-full bg-purple-400 animate-pulse"></span>
            القفازات (Gloves)
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-amber-500/10 border border-amber-500/25 text-amber-300">
            <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse"></span>
            غطاء الرأس (Cap/Hairnet)
          </span>
        </div>
      </div>

      {/* Main Grid: Upload & Controls + Canvas & Results */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Image Area & Visual Canvas (7 cols) */}
        <div className="lg:col-span-8 space-y-4">
          {/* Canvas Card */}
          <div className="bg-[#0f172a] border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            {/* Action Bar */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/80 bg-slate-900/50">
              <div className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-slate-400" />
                <span className="text-xs font-medium text-slate-300">
                  {selectedImage ? 'معاينة الصورة والرصد المباشر' : 'بانتظار رفع صورة للفحص'}
                </span>
              </div>

              {result && (
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-slate-400 flex items-center gap-1">
                    <Zap className="h-3.5 w-3.5 text-amber-400" />
                    زمن المعالجة: <strong className="text-slate-200">{result.inferenceTimeMs}ms</strong>
                  </span>
                  <span className="text-slate-400">
                    عناصر مرصودة: <strong className="text-emerald-400">{result.detections.length}</strong>
                  </span>
                </div>
              )}
            </div>

            {/* Image / Canvas Display */}
            <div
              className="relative min-h-[420px] max-h-[620px] bg-slate-950/60 flex items-center justify-center p-4 overflow-hidden select-none"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              ref={imageContainerRef}
            >
              {!selectedImage ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="cursor-pointer border-2 border-dashed border-slate-700/80 hover:border-amber-500/50 rounded-2xl p-8 text-center max-w-md transition-all duration-200 hover:bg-slate-900/40 group"
                >
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-800/80 text-slate-400 group-hover:text-amber-400 group-hover:bg-amber-500/10 group-hover:scale-105 transition">
                    <Upload className="h-8 w-8" />
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-white">اختر صورة أو اسحبها وأفلتها هنا</h3>
                  <p className="mt-1 text-xs text-slate-400">
                    يدعم صيغ JPG، PNG، WEBP (صور عمال، مطابخ، منشآت غذائية وصناعية)
                  </p>
                  <button
                    type="button"
                    className="mt-4 inline-flex items-center gap-2 rounded-xl bg-amber-500/10 border border-amber-500/30 px-4 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 transition"
                  >
                    استعراض الملفات من جهازك
                  </button>
                </div>
              ) : (
                <div className="relative inline-block max-w-full max-h-[580px]">
                  <img
                    ref={imgElementRef}
                    src={selectedImage}
                    alt="Target for PPE Detection"
                    className="max-h-[580px] max-w-full object-contain rounded-lg shadow-2xl block"
                  />

                  {/* Render Bounding Boxes Overlay */}
                  {result?.detections.map((det) => {
                    const isHovered = hoveredBoxId === det.id;
                    const [x1, y1, x2, y2] = det.box;
                    const left = `${x1 * 100}%`;
                    const top = `${y1 * 100}%`;
                    const width = `${(x2 - x1) * 100}%`;
                    const height = `${(y2 - y1) * 100}%`;

                    // Dynamic colors based on category
                    const boxBorderColor = det.category === 'mask'
                      ? 'border-emerald-500'
                      : det.category === 'gloves'
                      ? 'border-purple-500'
                      : det.category === 'cap'
                      ? 'border-amber-500'
                      : det.isViolation
                      ? 'border-rose-500'
                      : 'border-blue-500';

                    const tagBgColor = det.category === 'mask'
                      ? 'bg-emerald-600 text-white'
                      : det.category === 'gloves'
                      ? 'bg-purple-600 text-white'
                      : det.category === 'cap'
                      ? 'bg-amber-600 text-black font-bold'
                      : det.isViolation
                      ? 'bg-rose-600 text-white'
                      : 'bg-blue-600 text-white';

                    return (
                      <div
                        key={det.id}
                        onMouseEnter={() => setHoveredBoxId(det.id)}
                        onMouseLeave={() => setHoveredBoxId(null)}
                        style={{ left, top, width, height }}
                        className={`absolute border-2 transition-all duration-150 cursor-pointer pointer-events-auto ${boxBorderColor} ${
                          isHovered ? 'ring-4 ring-white/40 shadow-2xl z-20 scale-[1.01]' : 'opacity-90 z-10'
                        }`}
                      >
                        {/* Tag Label */}
                        <div
                          className={`absolute -top-6 right-0 text-[10px] px-1.5 py-0.5 rounded shadow whitespace-nowrap flex items-center gap-1 ${tagBgColor}`}
                        >
                          <span>{det.arabicLabel || det.label}</span>
                          <span className="font-mono text-[9px] opacity-90">({Math.round(det.confidence * 100)}%)</span>
                        </div>
                      </div>
                    );
                  })}

                  {/* Processing Overlay */}
                  {loading && (
                    <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-xs flex flex-col items-center justify-center rounded-lg z-30">
                      <div className="relative">
                        <div className="h-12 w-12 rounded-full border-4 border-amber-500/20 border-t-amber-500 animate-spin"></div>
                        <Sparkles className="h-5 w-5 text-amber-400 absolute inset-0 m-auto" />
                      </div>
                      <p className="mt-3 text-xs font-semibold text-slate-200">جاري المعالجة بالذكاء الاصطناعي...</p>
                      <span className="text-[11px] text-slate-400">فحص الوجه واليدين والرأس</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Quick Actions Footer */}
            <div className="p-3 bg-slate-900/60 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
              />

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1.5"
                >
                  <Upload className="h-3.5 w-3.5 text-slate-400" />
                  رفع صورة أخرى
                </button>

                {selectedImage && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedImage(null);
                      setImageFile(null);
                      setResult(null);
                    }}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-rose-400 hover:bg-rose-500/10 transition"
                  >
                    مسح الصورة
                  </button>
                )}
              </div>

              {selectedImage && (
                <button
                  type="button"
                  onClick={runDetection}
                  disabled={loading}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black shadow-lg shadow-amber-500/20 transition disabled:opacity-50 flex items-center gap-2"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      جاري الفحص...
                    </>
                  ) : (
                    <>
                      <Zap className="h-3.5 w-3.5 fill-black" />
                      بدء فحص الـ PPE الآن
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Sample Preset Images */}
          <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-4">
            <h4 className="text-xs font-bold text-slate-300 mb-3 flex items-center gap-1.5">
              <ImageIcon className="h-3.5 w-3.5 text-amber-400" />
              أو اختر من النماذج الجاهزة للاختبار الفوري:
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {PRESET_SAMPLES.map((preset, idx) => (
                <div
                  key={idx}
                  onClick={() => selectPreset(preset)}
                  className={`group relative rounded-xl border p-2 cursor-pointer transition-all duration-200 overflow-hidden ${
                    selectedImage === preset.url
                      ? 'border-amber-500 bg-amber-500/5 ring-2 ring-amber-500/30'
                      : 'border-slate-800 bg-slate-900/40 hover:border-slate-700 hover:bg-slate-900'
                  }`}
                >
                  <div className="aspect-video w-full rounded-lg overflow-hidden bg-slate-950 mb-2 relative">
                    <img
                      src={preset.url}
                      alt={preset.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                    />
                  </div>
                  <p className="text-xs font-semibold text-slate-200 line-clamp-1">{preset.name}</p>
                  <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">{preset.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Controls, Breakdown & Status (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          {/* Controls Card */}
          <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Sliders className="h-3.5 w-3.5 text-amber-400" />
                إعدادات نموذج الفحص
              </span>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                Active
              </span>
            </div>

            {/* Model Selector */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">النموذج المستخدم</label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-hidden focus:border-amber-500 transition"
              >
                <option value="yolo26-ppe">YOLO26 PPE (كمامة + قفازات + غطاء الرأس)</option>
                <option value="yolov8-ppe">YOLOv8 PPE Standard (خوذة + كمامة + سترة)</option>
              </select>
              <p className="mt-1 text-[11px] text-slate-400">
                مبني على بنية YOLO26 فائقة السرعة وبدون طبقة NMS مستقلة.
              </p>
            </div>

            {/* Confidence Slider */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-300">عتبة حساسية الرصد (Confidence)</label>
                <span className="text-xs font-mono font-bold text-amber-400">
                  {Math.round(confidenceThreshold * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0.10"
                max="0.80"
                step="0.05"
                value={confidenceThreshold}
                onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
                className="w-full accent-amber-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                <span>10% (حساس جداً)</span>
                <span>40% (متوازن)</span>
                <span>80% (صارم)</span>
              </div>
            </div>
          </div>

          {/* Results Analysis Card */}
          <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between border-b border-slate-800 pb-3">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                تحليل مهمات السلامة (PPE Breakdown)
              </span>
              {result && (
                <span
                  className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                    result.complianceSummary.overallCompliant
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25'
                      : 'bg-rose-500/10 text-rose-400 border border-rose-500/25'
                  }`}
                >
                  {result.complianceSummary.overallCompliant ? 'مطابق ✅' : 'مخالفة ⚠️'}
                </span>
              )}
            </h3>

            {error && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <strong className="block font-semibold">تنبيه:</strong>
                  {error}
                </div>
              </div>
            )}

            {!result && !error && (
              <div className="py-8 text-center text-slate-400 space-y-2">
                <Info className="h-8 w-8 mx-auto text-slate-400 opacity-60" />
                <p className="text-xs">قم برفع صورة واضغط على "بدء فحص الـ PPE" لعرض التقرير والتفاصيل هنا</p>
              </div>
            )}

            {result && (
              <div className="space-y-3">
                {/* 1. Mask Status */}
                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="h-8 w-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-base">
                      😷
                    </span>
                    <div>
                      <p className="text-xs font-bold text-white">كمامة الوجه (Face Mask)</p>
                      <p className="text-[11px] text-slate-400">
                        {result.complianceSummary.maskDetected
                          ? `تم رصد ارتداء الكمامة (${result.complianceSummary.maskCount})`
                          : 'لم يتم رصد ارتداء الكمامة'}
                      </p>
                    </div>
                  </div>
                  {result.complianceSummary.maskDetected ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="h-5 w-5 text-rose-400 shrink-0" />
                  )}
                </div>

                {/* 2. Gloves Status */}
                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="h-8 w-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-base">
                      🧤
                    </span>
                    <div>
                      <p className="text-xs font-bold text-white">قفازات اليدين (Hand Gloves)</p>
                      <p className="text-[11px] text-slate-400">
                        {result.complianceSummary.glovesDetected
                          ? `تم رصد ارتداء القفازات (${result.complianceSummary.glovesCount})`
                          : 'لم يتم رصد ارتداء القفازات'}
                      </p>
                    </div>
                  </div>
                  {result.complianceSummary.glovesDetected ? (
                    <CheckCircle2 className="h-5 w-5 text-purple-400 shrink-0" />
                  ) : (
                    <XCircle className="h-5 w-5 text-rose-400 shrink-0" />
                  )}
                </div>

                {/* 3. Cap / Hairnet Status */}
                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="h-8 w-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-base">
                      🧢
                    </span>
                    <div>
                      <p className="text-xs font-bold text-white">غطاء الرأس (Cap / Hairnet)</p>
                      <p className="text-[11px] text-slate-400">
                        {result.complianceSummary.capDetected
                          ? `تم رصد ارتداء غطاء الرأس (${result.complianceSummary.capCount})`
                          : 'لم يتم رصد غطاء الرأس'}
                      </p>
                    </div>
                  </div>
                  {result.complianceSummary.capDetected ? (
                    <CheckCircle2 className="h-5 w-5 text-amber-400 shrink-0" />
                  ) : (
                    <XCircle className="h-5 w-5 text-rose-400 shrink-0" />
                  )}
                </div>

                {/* List of Detections */}
                <div className="pt-2 border-t border-slate-800">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                    قائمة العناصر المرصودة ({result.detections.length}):
                  </p>
                  <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                    {result.detections.map((det) => (
                      <div
                        key={det.id}
                        onMouseEnter={() => setHoveredBoxId(det.id)}
                        onMouseLeave={() => setHoveredBoxId(null)}
                        className={`p-2 rounded-lg text-xs flex items-center justify-between cursor-pointer transition ${
                          hoveredBoxId === det.id
                            ? 'bg-slate-800 border border-amber-500/40 text-white'
                            : 'bg-slate-900/40 border border-slate-800/80 text-slate-300 hover:bg-slate-800/60'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: det.color || '#10b981' }}
                          ></span>
                          <span>{det.arabicLabel || det.label}</span>
                        </div>
                        <span className="font-mono text-xs font-bold text-slate-400">
                          {Math.round(det.confidence * 100)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Raw JSON Developer View */}
          {result && (
            <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-4">
              <button
                type="button"
                onClick={() => setShowJson(!showJson)}
                className="w-full flex items-center justify-between text-xs font-semibold text-slate-400 hover:text-slate-200 transition"
              >
                <span className="flex items-center gap-1.5">
                  <Code className="h-3.5 w-3.5" />
                  استجابة النموذج التفصيلية (Raw JSON)
                </span>
                <span>{showJson ? 'إخفاء ▲' : 'عرض ▼'}</span>
              </button>

              {showJson && (
                <pre className="mt-3 p-3 rounded-xl bg-slate-950 border border-slate-800 text-[10px] text-emerald-400 font-mono overflow-x-auto max-h-60">
                  {JSON.stringify(result, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
