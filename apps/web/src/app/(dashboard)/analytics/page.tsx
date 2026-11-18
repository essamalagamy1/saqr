'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { 
  TrendingUp, Users, ShieldCheck, AlertTriangle, Calendar, 
  Download, ArrowUpRight, ArrowDownRight, Clock, Building2, Check,
  Camera, Filter, RefreshCw, Loader2, ChevronLeft, AlertCircle
} from 'lucide-react';
import { api } from '@/lib/api';

interface CameraItem {
  id: string;
  name: string;
  branch_id?: string;
  dvr_ip?: string;
  dvr_channel?: string;
  status: string;
}

interface DetectionItem {
  id: string;
  camera_id?: string;
  camera_name?: string;
  type: string;
  confidence?: number;
  severity?: 'low' | 'medium' | 'high';
  detected_at?: string;
  metadata?: any;
}

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<'today' | '7d' | '30d'>('today');
  const [selectedCameraId, setSelectedCameraId] = useState<string>('all');
  const [exported, setExported] = useState(false);
  const [loading, setLoading] = useState(true);

  const [cameras, setCameras] = useState<CameraItem[]>([]);
  const [detections, setDetections] = useState<DetectionItem[]>([]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [camsData, detsData] = await Promise.all([
        api.get<CameraItem[]>('/cameras/').catch(() => []),
        api.get<DetectionItem[]>('/detections/').catch(() => []),
      ]);
      setCameras(Array.isArray(camsData) ? camsData : []);
      setDetections(Array.isArray(detsData) ? detsData : []);
    } catch (err) {
      console.error('Failed to load analytics data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Filter detections based on existing cameras and selected camera filter
  const relevantDetections = useMemo(() => {
    if (cameras.length === 0) return [];

    const existingCameraIds = new Set(cameras.map(c => c.id));
    return detections.filter(d => {
      // Must belong to an existing camera (if camera_id is present)
      if (d.camera_id && !existingCameraIds.has(d.camera_id)) return false;

      // Filter by selected camera
      if (selectedCameraId !== 'all' && d.camera_id !== selectedCameraId) return false;

      // Filter by period
      if (!d.detected_at) return true;
      const detTime = new Date(d.detected_at).getTime();
      const now = Date.now();
      if (period === 'today') {
        return (now - detTime) <= 24 * 60 * 60 * 1000;
      } else if (period === '7d') {
        return (now - detTime) <= 7 * 24 * 60 * 60 * 1000;
      } else if (period === '30d') {
        return (now - detTime) <= 30 * 24 * 60 * 60 * 1000;
      }
      return true;
    });
  }, [cameras, detections, selectedCameraId, period]);

  // Dynamic calculations based exclusively on existing cameras
  const activeCamerasCount = useMemo(() => {
    return cameras.filter(c => c.status === 'active' || c.status === 'online').length;
  }, [cameras]);

  const stats = useMemo(() => {
    // If no cameras are registered at all, strictly return zero values
    if (cameras.length === 0) {
      return {
        visitors: 0,
        visitorsChange: '0 كاميرات',
        compliance: '0%',
        complianceChange: 'لا توجد كاميرات',
        violations: 0,
        violationsChange: '0 مخالفات',
        waitTime: '0:00',
        traffic: [],
        totalTraffic: 0,
      };
    }

    // Violations count from relevant detections
    const violationsCount = relevantDetections.filter(
      d => d.severity === 'high' || d.severity === 'medium' || /مخالفة|تحذير|خطر|violation/i.test(d.type)
    ).length;

    // Visitors count from detections (e.g. people/visitor counting)
    let visitorsSum = 0;
    const visitorDetections = relevantDetections.filter(
      d => /زائر|دخول|توافد|person|visitor|crowd/i.test(d.type)
    );
    for (const d of visitorDetections) {
      const count = d.metadata?.count || d.metadata?.persons || 1;
      visitorsSum += Number(count) || 1;
    }

    // Compliance rate
    let complianceStr = '100%';
    if (activeCamerasCount === 0) {
      complianceStr = '0%';
    } else if (relevantDetections.length > 0) {
      const safeRatio = Math.max(0, 1 - (violationsCount / relevantDetections.length));
      complianceStr = `${Math.round(safeRatio * 100)}%`;
    }

    // Average wait time from queue detections
    let waitMinutes = 0;
    const queueDetections = relevantDetections.filter(d => /طابور|انتظار|queue/i.test(d.type));
    if (queueDetections.length > 0) {
      const totalWait = queueDetections.reduce((acc, d) => acc + (d.metadata?.wait_time_minutes || 2), 0);
      waitMinutes = Math.round(totalWait / queueDetections.length);
    }
    const waitTimeStr = waitMinutes > 0 ? `${waitMinutes}:00` : '0:00';

    // Generate traffic distribution
    let traffic: { hour: string; in: number; out: number }[] = [];
    if (period === 'today') {
      const hours = ['08 ص', '10 ص', '12 م', '02 م', '04 م', '06 م', '08 م', '10 م'];
      traffic = hours.map((h, i) => {
        const hourNumber = 8 + i * 2;
        const matching = relevantDetections.filter(d => {
          if (!d.detected_at) return false;
          const dt = new Date(d.detected_at);
          return dt.getHours() >= hourNumber && dt.getHours() < hourNumber + 2;
        });
        const inCount = matching.filter(d => !/خروج|exit|out/i.test(d.type)).length;
        const outCount = matching.filter(d => /خروج|exit|out/i.test(d.type)).length;
        return { hour: h, in: inCount, out: outCount };
      });
    } else if (period === '7d') {
      const days = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
      traffic = days.map((day, dayIdx) => {
        const matching = relevantDetections.filter(d => {
          if (!d.detected_at) return false;
          const dt = new Date(d.detected_at);
          // Saturday is 6 in JS (0 is Sunday, 6 is Saturday)
          const jsDay = (dayIdx + 6) % 7;
          return dt.getDay() === jsDay;
        });
        return {
          hour: day,
          in: matching.filter(d => !/خروج|exit|out/i.test(d.type)).length,
          out: matching.filter(d => /خروج|exit|out/i.test(d.type)).length,
        };
      });
    } else {
      const weeks = ['الأسبوع 1', 'الأسبوع 2', 'الأسبوع 3', 'الأسبوع 4'];
      traffic = weeks.map((w, wIdx) => {
        const now = Date.now();
        const startMs = now - (4 - wIdx) * 7 * 24 * 60 * 60 * 1000;
        const endMs = startMs + 7 * 24 * 60 * 60 * 1000;
        const matching = relevantDetections.filter(d => {
          if (!d.detected_at) return false;
          const t = new Date(d.detected_at).getTime();
          return t >= startMs && t < endMs;
        });
        return {
          hour: w,
          in: matching.filter(d => !/خروج|exit|out/i.test(d.type)).length,
          out: matching.filter(d => /خروج|exit|out/i.test(d.type)).length,
        };
      });
    }

    const totalTraffic = traffic.reduce((acc, t) => acc + t.in + t.out, 0);

    return {
      visitors: visitorsSum,
      visitorsChange: activeCamerasCount > 0 ? `${activeCamerasCount} كاميرات نشطة` : 'لا توجد كاميرات نشطة',
      compliance: complianceStr,
      complianceChange: activeCamerasCount > 0 ? 'رصد فوري' : 'غير متصل',
      violations: violationsCount,
      violationsChange: activeCamerasCount > 0 ? 'رصد حي' : 'متوقف',
      waitTime: waitTimeStr,
      traffic,
      totalTraffic,
    };
  }, [cameras, activeCamerasCount, relevantDetections, period]);

  const maxVal = Math.max(1, ...(stats.traffic.map(h => Math.max(h.in, h.out))));

  const handleExportCSV = () => {
    const csvContent = "data:text/csv;charset=utf-8," 
      + "الفترة,الكاميرا,الزوار,الامتثال,المخالفات,متوسط الانتظار\n"
      + `${period},${selectedCameraId},${stats.visitors},${stats.compliance},${stats.violations},${stats.waitTime}\n\n`
      + "الفترة الفرعية,دخول,خروج\n"
      + stats.traffic.map(t => `${t.hour},${t.in},${t.out}`).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `rased_analytics_${period}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setExported(true);
    setTimeout(() => setExported(false), 2500);
  };

  return (
    <div className="space-y-6">
      {/* Page Title & Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800/80 pb-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-amber-500" />
            <span>التحليلات المتقدمة والتقارير التنفيذية</span>
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            تحليل حركة الزوار، مؤشرات الامتثال، ومعدلات الأداء المستخلصة من الكاميرات الفعلية
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Camera Filter Selector */}
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-[#0d1527] px-2.5 py-1 text-xs">
            <Camera className="h-3.5 w-3.5 text-amber-500" />
            <select
              value={selectedCameraId}
              onChange={(e) => setSelectedCameraId(e.target.value)}
              className="bg-transparent text-slate-200 text-xs focus:outline-none cursor-pointer"
            >
              <option value="all" className="bg-[#0d1527] text-white">
                كافة الكاميرات ({cameras.length})
              </option>
              {cameras.map((c) => (
                <option key={c.id} value={c.id} className="bg-[#0d1527] text-white">
                  {c.name} {c.dvr_channel ? `(${c.dvr_channel})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Period selector */}
          <div className="flex rounded-lg border border-slate-800 bg-[#0d1527] p-0.5 text-xs">
            <button
              onClick={() => setPeriod('today')}
              className={`rounded-md px-3 py-1 font-semibold transition ${
                period === 'today' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              اليوم
            </button>
            <button
              onClick={() => setPeriod('7d')}
              className={`rounded-md px-3 py-1 font-semibold transition ${
                period === '7d' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              آخر 7 أيام
            </button>
            <button
              onClick={() => setPeriod('30d')}
              className={`rounded-md px-3 py-1 font-semibold transition ${
                period === '30d' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              هذا الشهر
            </button>
          </div>

          {/* Refresh Button */}
          <button
            onClick={loadData}
            title="تحديث البيانات"
            className="flex items-center gap-1 rounded-lg border border-slate-800 bg-[#0d1527] px-2.5 py-1.5 text-xs text-slate-300 hover:text-white hover:border-slate-700 transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-amber-500 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {/* Export CSV */}
          <button 
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white hover:border-slate-700 transition"
          >
            {exported ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-emerald-400 font-bold">تم التصدير!</span>
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5 text-amber-500" />
                <span>تصدير CSV</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* No Cameras Warning Banner */}
      {cameras.length === 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-right">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-bold text-white">لا توجد أي كاميرات مسجلة في النظام حالياً</div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                كافة المؤشرات الإحصائية والتحليلات تعتمد حصرياً على الكاميرات المتصلة. قم بفحص وإضافة الكاميرات لبدء التحليل.
              </div>
            </div>
          </div>
          <Link
            href="/cameras"
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400 transition shrink-0"
          >
            <span>إدارة وفحص الكاميرات</span>
            <ChevronLeft className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      {/* Four KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Visitors Card */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0d1527] p-4">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>إجمالي التوافد (الزوار)</span>
            <Users className="h-4 w-4 text-blue-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white tracking-tight">{stats.visitors}</span>
            <span className="text-[11px] font-semibold text-slate-400">
              {stats.visitorsChange}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {cameras.length > 0 ? `مستخلص من الكاميرات المسجلة` : 'بانتظار ربط الكاميرات'}
          </div>
        </div>

        {/* Compliance Rate */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0d1527] p-4">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>مؤشر الامتثال والسلامة</span>
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-emerald-400 tracking-tight">{stats.compliance}</span>
            <span className="text-[11px] font-semibold text-emerald-400">
              {stats.complianceChange}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {activeCamerasCount > 0 ? 'مراقبة الامتثال والزي والقفازات' : 'غير متاح لعدم وجود بث نشط'}
          </div>
        </div>

        {/* Violations Count */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0d1527] p-4">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>إجمالي المخالفات المرصودة</span>
            <AlertTriangle className="h-4 w-4 text-amber-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-amber-400 tracking-tight">{stats.violations}</span>
            <span className="text-[11px] font-semibold text-slate-400">
              {stats.violationsChange}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {activeCamerasCount > 0 ? 'سجل المخالفات من الكاميرات' : 'لا توجد مخالفات'}
          </div>
        </div>

        {/* Avg Wait Time */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0d1527] p-4">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>متوسط زمن الانتظار (طوابير)</span>
            <Clock className="h-4 w-4 text-purple-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white tracking-tight">{stats.waitTime}</span>
            <span className="text-[11px] text-slate-400">دقيقة</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500">منطقة الكاشير والطلبات</div>
        </div>
      </div>

      {/* Traffic Chart Card */}
      <div className="rounded-xl border border-slate-800/80 bg-[#0d1527] p-5 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
          <div>
            <h2 className="text-sm font-bold text-white">تحليل حركة التوافد وكثافة الزوار</h2>
            <p className="text-xs text-slate-400">إحصائيات الدخول والخروج المحسوبة من الكاميرات الفعلية</p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5 text-slate-300">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500"></span>
              دخول الزوار
            </span>
            <span className="flex items-center gap-1.5 text-slate-300">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-700"></span>
              خروج الزوار
            </span>
          </div>
        </div>

        {cameras.length === 0 ? (
          <div className="h-56 w-full flex flex-col items-center justify-center border border-dashed border-slate-800 rounded-lg p-6 text-center text-slate-500">
            <Camera className="h-8 w-8 text-slate-600 mb-2" />
            <div className="text-xs font-bold text-slate-300">لا توجد كاميرات متصلة لتوليد مخطط الحركة</div>
            <p className="text-[11px] text-slate-500 mt-1 mb-3">قم بربط الكاميرات من صفحة إدارة الكاميرات لرصد حركة الزوار آلياً</p>
            <Link
              href="/cameras"
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400 transition"
            >
              <span>ربط الكاميرات الآن</span>
              <ChevronLeft className="h-3 w-3" />
            </Link>
          </div>
        ) : stats.totalTraffic === 0 ? (
          <div className="h-56 w-full flex flex-col items-center justify-center border border-dashed border-slate-800 rounded-lg p-6 text-center text-slate-500">
            <Users className="h-8 w-8 text-slate-600 mb-2" />
            <div className="text-xs font-bold text-slate-300">لا توجد حركة مسجلة خلال هذه الفترة</div>
            <p className="text-[11px] text-slate-500 mt-1">
              الكاميرات المسجلة ({cameras.length}) متصلة، وسيظهر الرسم البياني فور رصد حركة ودخول زوار عبر نماذج الذكاء الاصطناعي.
            </p>
          </div>
        ) : (
          <div className="h-56 w-full flex items-end gap-2 sm:gap-4 pt-6 pb-2 border-b border-slate-800">
            {stats.traffic.map((slot, idx) => {
              const inHeight = Math.max(4, Math.round((slot.in / maxVal) * 100));
              const outHeight = Math.max(4, Math.round((slot.out / maxVal) * 100));
              return (
                <div key={idx} className="flex-1 flex flex-col items-center h-full justify-end group">
                  <div className="w-full flex items-end justify-center gap-1 h-full">
                    <div 
                      style={{ height: slot.in > 0 ? `${inHeight}%` : '4px' }}
                      className={`w-full max-w-[14px] rounded-t transition-all relative ${
                        slot.in > 0 ? 'bg-gradient-to-t from-amber-500 to-amber-400 group-hover:brightness-110' : 'bg-slate-800'
                      }`}
                    >
                      {slot.in > 0 && (
                        <span className="opacity-0 group-hover:opacity-100 absolute -top-6 left-1/2 -translate-x-1/2 bg-black/90 px-1.5 py-0.5 rounded text-[10px] text-amber-400 font-bold transition pointer-events-none">
                          {slot.in}
                        </span>
                      )}
                    </div>
                    <div 
                      style={{ height: slot.out > 0 ? `${outHeight}%` : '4px' }}
                      className={`w-full max-w-[14px] rounded-t transition-all relative ${
                        slot.out > 0 ? 'bg-slate-600 group-hover:bg-slate-500' : 'bg-slate-850'
                      }`}
                    >
                      {slot.out > 0 && (
                        <span className="opacity-0 group-hover:opacity-100 absolute -top-6 left-1/2 -translate-x-1/2 bg-black/90 px-1.5 py-0.5 rounded text-[10px] text-slate-300 font-bold transition pointer-events-none">
                          {slot.out}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-500 mt-2 font-medium truncate max-w-full">{slot.hour}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
