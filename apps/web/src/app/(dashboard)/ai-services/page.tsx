'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  BrainCircuit,
  Smartphone,
  ShieldCheck,
  ChefHat,
  Camera,
  CheckCircle2,
  Sliders,
  RefreshCw,
  SlidersHorizontal,
  ChevronLeft
} from 'lucide-react';
import { api } from '@/lib/api';

interface AIServiceModel {
  id?: string;
  key: string;
  name: string;
  enName: string;
  description: string;
  weights: string;
  size: string;
  mAP50: string;
  classes: string[];
  activeCamerasCount?: number;
  isActive: boolean;
}

export default function AIServicesPage() {
  const [cameras, setCameras] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);

  const [models, setModels] = useState<AIServiceModel[]>([
    {
      key: 'face_mask',
      name: 'كشف ارتداء الكمامة والالتزام الصحي',
      enName: 'YOLO26 Face Mask Detection',
      description: 'اكتشاف وتصنيف وجوه العاملين إلى: يرتدي كمامة بشكل صحيح، بدون كمامة، أو كمامة مرتداة بطريقة غير سليمة.',
      weights: 'face_mask.onnx',
      size: '9.4 MB',
      mAP50: '79.8%',
      classes: ['with_mask (كمامة سليمة)', 'without_mask (بدون كمامة)', 'mask_weared_incorrect (ارتداء خاطئ)'],
      isActive: true,
    },
    {
      key: 'gloves',
      name: 'كشف قفازات المطبخ والأيدي المكشوفة',
      enName: 'YOLO26 Gloves & Bare Hand Detection',
      description: 'التمييز بين ارتداء قفازات الاستخدام الواحد وكشف مخالفة لمس الأطعمة والأدوات بالأيدي المكشوفة.',
      weights: 'gloves.onnx',
      size: '9.4 MB',
      mAP50: '83.8%',
      classes: ['gloves (قفازات استخدام واحد)', 'bare_hand (مخالفة: يد مكشوفة)'],
      isActive: true,
    },
    {
      key: 'phone',
      name: 'كشف استخدام الهاتف المحمول أثناء العمل',
      enName: 'YOLO26 Mobile Phone Usage Detection',
      description: 'رصد انشغال الطهاة أو العاملين بالهواتف المحمولة في اليدين أو وضعها على الأذن أثناء ساعات العمل.',
      weights: 'phone.onnx',
      size: '9.4 MB',
      mAP50: '99.5%',
      classes: ['cell_phone (هاتف محمول قيد الاستخدام)'],
      isActive: true,
    },
  ]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [cams, dbServices] = await Promise.all([
        api.get<any[]>('/cameras/').catch(() => []),
        api.get<any[]>('/ai-services/').catch(() => []),
      ]);
      const camList = Array.isArray(cams) ? cams : [];
      const serviceList = Array.isArray(dbServices) ? dbServices : [];
      setCameras(camList);

      const dbMap = new Map(serviceList.map((s: any) => [s.slug, s]));

      setModels((prev) =>
        prev.map((m) => {
          const dbItem: any = dbMap.get(m.key);
          const count = camList.filter((c: any) => {
            let conf: any = {};
            try {
              conf = typeof c.config === 'string' ? JSON.parse(c.config) : (c.config || {});
            } catch {}
            const svcs = conf.enabled_services || ['kitchen_ppe', 'gloves', 'phone_usage'];
            if (m.key === 'face_mask') return svcs.includes('kitchen_ppe') || svcs.includes('face_mask');
            if (m.key === 'gloves') return svcs.includes('gloves');
            if (m.key === 'phone') return svcs.includes('phone_usage') || svcs.includes('phone');
            return false;
          }).length;

          return {
            ...m,
            id: dbItem?.id,
            isActive: dbItem ? dbItem.is_active : m.isActive,
            activeCamerasCount: count,
          };
        })
      );
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const toggleModelActive = async (model: AIServiceModel) => {
    const newStatus = !model.isActive;
    setTogglingKey(model.key);
    try {
      if (model.id) {
        await api.patch(`/ai-services/${model.id}/status`, { is_active: newStatus });
      }
      setModels((prev) =>
        prev.map((m) => (m.key === model.key ? { ...m, isActive: newStatus } : m))
      );
    } catch (err: any) {
      alert('تعذر تحديث حالة النموذج: ' + (err.message || ''));
    } finally {
      setTogglingKey(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white flex items-center gap-2">
              <BrainCircuit className="h-5 w-5 text-sky-400" />
              نماذج التحليل البصري المستقلة (YOLO26)
            </h1>
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
              3 نماذج مستقلة
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            منظومة مدربة على أوزان منفصلة تماماً لكل نوع مخالفة لضمان أقصى درجات الدقة وسرعة الاستجابة اللحظية
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadData}
            title="تحديث الحالة"
            className="p-2 rounded-md border border-slate-800 bg-slate-900/60 text-slate-400 hover:text-white transition"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <Link
            href="/cameras"
            className="flex items-center gap-1.5 rounded-md bg-sky-600 hover:bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-white transition"
          >
            <Camera className="h-3.5 w-3.5" />
            <span>تخصيص النماذج على الكاميرات</span>
          </Link>
        </div>
      </div>

      {/* 3 Dedicated YOLO26 Model Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {models.map((model) => {
          const Icon = model.key === 'face_mask' ? ChefHat : model.key === 'gloves' ? ShieldCheck : Smartphone;
          return (
            <div
              key={model.key}
              className="rounded-lg border border-slate-800/80 bg-[#0d131f] p-5 flex flex-col justify-between hover:border-slate-700 transition"
            >
              <div>
                {/* Header */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-md bg-slate-800 text-slate-200">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-xs sm:text-sm text-white">{model.name}</h3>
                      <div className="font-mono text-[10px] text-slate-400">{model.enName}</div>
                    </div>
                  </div>
                  <span
                    className={`font-mono text-[10px] px-2 py-0.5 rounded border ${
                      model.isActive
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                        : 'border-slate-800 bg-slate-900 text-slate-400'
                    }`}
                  >
                    {model.isActive ? 'ACTIVE' : 'OFFLINE'}
                  </span>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed mb-4">
                  {model.description}
                </p>

                {/* Technical Metrics Table */}
                <div className="rounded-md border border-slate-800/80 bg-slate-900/40 p-3 space-y-2 mb-4 font-mono text-[11px]">
                  <div className="flex items-center justify-between text-slate-400">
                    <span>دقة النموذج (mAP50):</span>
                    <span className="font-bold text-emerald-400">{model.mAP50}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-400">
                    <span>ملف الأوزان:</span>
                    <span className="text-slate-300">{model.weights} ({model.size})</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-400">
                    <span>الكاميرات المرتبطة:</span>
                    <span className="text-sky-400">{model.activeCamerasCount ?? cameras.length} كاميرا</span>
                  </div>
                </div>

                {/* Classification Classes */}
                <div>
                  <div className="text-[11px] font-semibold text-slate-300 mb-1.5">التصنيفات المعتمدة:</div>
                  <div className="flex flex-wrap gap-1">
                    {model.classes.map((cls, idx) => (
                      <span
                        key={idx}
                        className="font-mono text-[10px] px-2 py-0.5 rounded bg-slate-800/80 text-slate-300 border border-slate-700/60"
                      >
                        {cls}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Footer Controls */}
              <div className="pt-4 mt-4 border-t border-slate-800/80 flex items-center justify-between">
                <Link
                  href="/cameras"
                  className="text-xs text-sky-400 hover:text-sky-300 font-medium flex items-center gap-1"
                >
                  <span>ربط بكاميرات محددة</span>
                  <ChevronLeft className="h-3 w-3" />
                </Link>

                <button
                  type="button"
                  disabled={togglingKey === model.key}
                  onClick={() => toggleModelActive(model)}
                  className={`font-mono text-[11px] px-3 py-1 rounded transition border disabled:opacity-50 ${
                    model.isActive
                      ? 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
                      : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  }`}
                >
                  {togglingKey === model.key
                    ? 'جاري التحديث...'
                    : model.isActive
                    ? 'تعطيل مؤقت'
                    : 'تفعيل النموذج'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Operational Architecture Note */}
      <div className="rounded-lg border border-slate-800/80 bg-[#0d131f] p-4 text-xs text-slate-400 space-y-1.5">
        <div className="font-semibold text-slate-200 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-sky-400" />
          <span>مبدأ المعمارية المستقلة لنماذج YOLO26 في صقر</span>
        </div>
        <p className="leading-relaxed">
          كل نموذج يمتلك مجموعة بيانات تدريبية مستقلة (Dataset)، وأوزان منفصلة (ONNX)، ولا يتم دمج التصنيفات في نموذج واحد لمنع تداخل أوزان كشف الوجوه مع الأيدي أو الهواتف. يتم استدعاء النماذج بشكل متزامن وبسرعة معالجة لا تتعدى 15ms للإطار الواحد عبر تقنية DirectML و ONNX Runtime.
        </p>
      </div>
    </div>
  );
}
