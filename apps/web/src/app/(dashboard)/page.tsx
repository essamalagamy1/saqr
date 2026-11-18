'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Camera,
  BrainCircuit,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  ShieldAlert,
  Sparkles,
  SlidersHorizontal,
  RefreshCw,
  Printer,
  ChevronLeft,
  X,
  Check,
  BellRing
} from 'lucide-react';
import { api } from '@/lib/api';

export default function DashboardPage() {
  const [stats, setStats] = useState({
    active_cameras: 0,
    active_services: 0,
    total_detections: 0,
    unread_detections: 0,
  });

  const [recentDetections, setRecentDetections] = useState<any[]>([]);
  const [isLiveApi, setIsLiveApi] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [dateRange, setDateRange] = useState(() => {
    return `اليوم (${new Date().toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' })})`;
  });
  const [notificationEnabled, setNotificationEnabled] = useState(false);

  const fetchLiveStats = async () => {
    try {
      const statsData = await api.get<any>('/detections/stats');
      if (statsData) {
        setStats({
          active_cameras: statsData.active_cameras ?? 0,
          active_services: statsData.active_services ?? 0,
          total_detections: statsData.total_detections ?? 0,
          unread_detections: statsData.unread_detections ?? 0,
        });
        setIsLiveApi(true);
      }

      const detData = await api.get<any[]>('/detections/');
      if (detData && Array.isArray(detData)) {
        setRecentDetections(detData.slice(0, 4));
      }
    } catch (e) {
      console.error('Error fetching live stats:', e);
    }
  };

  useEffect(() => {
    fetchLiveStats();
    const interval = setInterval(fetchLiveStats, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleRequestNotifications = async () => {
    if ('Notification' in window) {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        setNotificationEnabled(true);
        new Notification('منصة صَقْر الذكية', {
          body: 'تم تفعيل التنبيهات المباشرة بنجاح على هذا المتصفح!',
          icon: '/favicon.ico'
        });
      } else {
        alert('تم رفض إذن الإشعارات من إعدادات المتصفح');
      }
    } else {
      alert('متصفحك لا يدعم الإشعارات اللحظية');
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Professional Operational Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight text-white">
              مركز العمليات والمراقبة الميدانية
            </h1>
            <span className="flex items-center gap-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-[11px] font-semibold text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>النظام نشط</span>
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            منظومة صَقْر للرصد والتحليل الذكي • فرع القاهرة الجديدة (FIT FOR LESS)
          </p>
        </div>

        {/* Top Operational Controls */}
        <div className="flex items-center gap-2">
          <div className="rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-300 font-mono">
            {dateRange}
          </div>
          <button
            onClick={fetchLiveStats}
            title="تحديث البيانات لحظياً"
            className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white hover:border-slate-700 transition"
          >
            <RefreshCw className="h-3.5 w-3.5 text-amber-500" />
            <span>تحديث</span>
          </button>
          <button
            onClick={() => window.print()}
            title="طباعة تقرير العمليات"
            className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white hover:border-slate-700 transition"
          >
            <Printer className="h-3.5 w-3.5" />
            <span>تقرير</span>
          </button>
          <Link
            href="/live"
            className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400 transition"
          >
            <span>شاشة البث الكاملة</span>
            <ChevronLeft className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* 2. Four Core Operational Metric Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Cameras Metric */}
        <Link href="/cameras" className="rounded-xl border border-slate-800/80 bg-[#0d1527] p-4 hover:border-slate-700 transition block group">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>الكاميرات المتصلة</span>
            <Camera className="h-4 w-4 text-blue-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-white tracking-tight">
            {stats.active_cameras} <span className="text-xs font-normal text-slate-400">كاميرات</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>قيد المعالجة عبر Edge Agent</span>
          </div>
        </Link>

        {/* AI Models Metric */}
        <Link href="/ai-services" className="rounded-xl border border-slate-800/80 bg-[#0d1527] p-4 hover:border-slate-700 transition block group">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>نماذج الذكاء (YOLOX)</span>
            <BrainCircuit className="h-4 w-4 text-purple-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-white tracking-tight">
            {stats.active_services} <span className="text-xs font-normal text-slate-400">خدمات</span>
          </div>
          <div className="mt-2 text-[11px] text-slate-400">
            موزعة على قنوات المراقبة
          </div>
        </Link>

        {/* Total Today Detections */}
        <Link href="/detections" className="rounded-xl border border-slate-800/80 bg-[#0d1527] p-4 hover:border-slate-700 transition block group">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>إجمالي رصد اليوم</span>
            <Activity className="h-4 w-4 text-amber-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-white tracking-tight">
            {stats.total_detections} <span className="text-xs font-normal text-slate-400">حدث</span>
          </div>
          <div className="mt-2 text-[11px] text-amber-400">
            تحديث لحظي من الكاميرات
          </div>
        </Link>

        {/* Unread / Pending Action */}
        <Link href="/detections" className="rounded-xl border border-slate-800/80 bg-[#0d1527] p-4 hover:border-slate-700 transition block group">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>تنبيهات معلقة</span>
            <ShieldAlert className="h-4 w-4 text-red-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-white tracking-tight">
            {stats.unread_detections} <span className="text-xs font-normal text-slate-400">تحتاج اعتماد</span>
          </div>
          <div className="mt-2 text-[11px] text-red-400">
            تتطلب متابعة ميدانية
          </div>
        </Link>
      </div>

      {/* 3. Live Feeds Operational Strip */}
      <div className="rounded-xl border border-slate-800/80 bg-[#0d1527] p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
            <h2 className="text-sm font-bold text-white">معاينة البث الميداني الحي (Live Feeds)</h2>
            <span className="text-xs text-slate-500">2 قنوات متصلة</span>
          </div>
          <Link href="/live" className="text-xs font-medium text-amber-400 hover:text-amber-300 flex items-center gap-1 transition">
            <span>فتح شبكة الكاميرات الكاملة</span>
            <ChevronLeft className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Camera 1: Live Stream Preview */}
          <div className="overflow-hidden rounded-lg border border-slate-800 bg-[#070b14]">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800/80 bg-slate-900/60 text-xs">
              <span className="font-semibold text-slate-200">Fit 4 Less 1 - المدخل الرئيسي</span>
              <span className="text-[10px] text-emerald-400 font-mono bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">LIVE • 1080p</span>
            </div>
            <div className="relative aspect-video w-full bg-black">
              <iframe
                src="http://localhost:8888/cam1/?controls=0&autoplay=1&muted=1"
                className="w-full h-full border-0 pointer-events-none"
                title="Fit 4 Less 1 - المدخل الرئيسي"
              />
            </div>
          </div>

          {/* Camera 2: Local WiFi Camera Preview */}
          <div className="overflow-hidden rounded-lg border border-slate-800 bg-[#070b14] flex flex-col justify-between">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800/80 bg-slate-900/60 text-xs">
              <span className="font-semibold text-slate-200">كاميرا شبكة الواي فاي المحلية</span>
              <span className="text-[10px] text-amber-400 font-mono bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">RTSP • 192.168.100.53</span>
            </div>
            <div className="relative aspect-video w-full flex flex-col items-center justify-center p-6 text-center bg-slate-950/60">
              <Camera className="h-8 w-8 text-amber-500/60 mb-2" />
              <div className="text-xs font-semibold text-slate-300">كاميرا EZVIZ على الشبكة المحلية</div>
              <div className="text-[11px] text-slate-500 font-mono mt-1">rtsp://admin:****@192.168.100.53:554</div>
              <span className="mt-3 rounded-full bg-amber-500/10 border border-amber-500/30 px-2.5 py-0.5 text-[10px] text-amber-400">
                بانتظار إدخال كود التحقق في Edge Agent
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Real-time Incident Feed Table */}
      <div className="rounded-xl border border-slate-800/80 bg-[#0d1527] p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-amber-500" />
            <h2 className="text-sm font-bold text-white">سجل العمليات والإنذارات الحية</h2>
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-mono text-slate-400">
              {recentDetections.length} أحداث
            </span>
          </div>
          <Link href="/detections" className="text-xs font-medium text-amber-400 hover:text-amber-300 flex items-center gap-1 transition">
            <span>عرض كافة السجلات</span>
            <ChevronLeft className="h-3.5 w-3.5" />
          </Link>
        </div>

        {recentDetections.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-800 p-8 text-center text-slate-500">
            <CheckCircle2 className="h-6 w-6 mx-auto mb-2 text-emerald-500/60" />
            <p className="text-xs font-medium text-slate-300">لا توجد مخالفات مسجلة حالياً</p>
            <p className="text-[11px] text-slate-500 mt-0.5">كاميرات المراقبة تعمل ونظام التحليل في وضع الجاهزية</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-medium">
                  <th className="pb-2.5 pr-3">التوقيت</th>
                  <th className="pb-2.5">الكاميرا</th>
                  <th className="pb-2.5">نوع الحدث</th>
                  <th className="pb-2.5">نسبة الثقة</th>
                  <th className="pb-2.5">مستوى الخطورة</th>
                  <th className="pb-2.5 pl-3 text-left">الإجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {recentDetections.map((det) => (
                  <tr key={det.id} className="hover:bg-slate-800/30 transition">
                    <td className="py-3 pr-3 font-mono text-slate-400 text-[11px]">
                      {det.detected_at
                        ? new Date(det.detected_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                        : 'الآن'}
                    </td>
                    <td className="py-3 font-medium text-slate-200">
                      {det.camera_name || 'Fit 4 Less 1 - المدخل الرئيسي'}
                    </td>
                    <td className="py-3 text-slate-100 font-semibold">
                      {det.type}
                    </td>
                    <td className="py-3 font-mono text-emerald-400">
                      {Math.round((det.confidence || 0.95) * 100)}%
                    </td>
                    <td className="py-3">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold border ${
                        det.severity === 'high'
                          ? 'border-red-500/30 bg-red-500/10 text-red-400'
                          : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                      }`}>
                        {det.severity === 'high' ? 'عالية' : 'متوسطة'}
                      </span>
                    </td>
                    <td className="py-3 pl-3 text-left">
                      <Link
                        href={`/detections?search=${encodeURIComponent(det.id)}`}
                        className="rounded border border-slate-700 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-300 hover:text-white hover:bg-slate-700 transition"
                      >
                        معاينة
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Upgrade Subscription Modal */}
      {showUpgradeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-[#0d1527] p-6 shadow-2xl text-right">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-amber-400 font-bold">
                <Sparkles className="h-5 w-5" />
                <span>ترقية باقة صَقْر — الاشتراكات والأسعار</span>
              </div>
              <button onClick={() => setShowUpgradeModal(false)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-white">باقة Pro للمطاعم</span>
                  <span className="rounded bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-black">الأكثر طلباً</span>
                </div>
                <div className="mt-2 text-2xl font-bold text-amber-400">99$ <span className="text-xs text-slate-400 font-normal">/ شهرياً لكل فرع</span></div>
                <ul className="mt-3 space-y-2 text-xs text-slate-300">
                  <li className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    <span>حتى 8 كاميرات بدقة 1080p في كل فرع</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    <span>كافة نماذج YOLOX (الزي الموحد، النظافة، الطوابير، التسكع)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    <span>تنبيهات لحظية عبر Telegram والويب</span>
                  </li>
                </ul>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="text-sm font-bold text-white">باقة Enterprise للمؤسسات الكبرى</div>
                <div className="mt-1 text-xs text-slate-400">فروع غير محدودة، تخصيص نماذج AI خاصة، وسيرفرات محلية On-Premise</div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => setShowUpgradeModal(false)}
                className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white"
              >
                إغلاق
              </button>
              <a
                href="https://wa.me/201000000000"
                target="_blank"
                rel="noreferrer"
                className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-black hover:bg-amber-400 transition"
              >
                تواصل مع المبيعات للتفعيل
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Date Filter Modal */}
      {showFilterModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-[#0d1527] p-6 shadow-2xl text-right">
            <h3 className="text-sm font-bold text-white mb-3">اختر النطاق الزمني للإحصائيات</h3>
            <div className="space-y-2 text-xs">
              {['اليوم (17 نوفمبر 2026)', 'أمس', 'آخر 7 أيام', 'هذا الشهر'].map((range) => (
                <button
                  key={range}
                  onClick={() => {
                    setDateRange(range);
                    setShowFilterModal(false);
                  }}
                  className={`w-full text-right p-3 rounded-lg border transition ${
                    dateRange === range
                      ? 'border-amber-500 bg-amber-500/10 text-amber-400 font-bold'
                      : 'border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-850'
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
