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
  RefreshCw,
  Printer,
  ChevronLeft,
  Video
} from 'lucide-react';
import { api } from '@/lib/api';
import { LiveStreamPlayer } from '@/components/dashboard/live-stream-player';

export default function DashboardPage() {
  const [stats, setStats] = useState({
    active_cameras: 0,
    active_services: 3,
    total_detections: 0,
    unread_detections: 0,
  });

  const [liveCameras, setLiveCameras] = useState<any[]>([]);
  const [recentDetections, setRecentDetections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLiveStats = async () => {
    try {
      const [statsData, detData, camsData] = await Promise.all([
        api.get<any>('/detections/stats').catch(() => null),
        api.get<any[]>('/detections/?limit=6').catch(() => []),
        api.get<any[]>('/cameras/').catch(() => []),
      ]);

      const cams = Array.isArray(camsData) ? camsData : [];
      const activeCams = cams.filter((c: any) => c.status === 'active' || c.status === 'online');
      const activeCount = activeCams.length;

      const validDetections = Array.isArray(detData) ? detData : [];

      setStats({
        active_cameras: activeCount,
        active_services: 3, // strictly 3 YOLO26 models
        total_detections: statsData?.total_detections ?? validDetections.length,
        unread_detections: statsData?.unread_detections ?? 0,
      });

      setRecentDetections(validDetections.slice(0, 6));
      setLiveCameras(cams);
    } catch (e) {
      console.error('Error fetching live stats:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLiveStats();
    const interval = setInterval(fetchLiveStats, 8000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6">
      {/* 1. Operational Command Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white">
              مركز العمليات والمراقبة الميدانية
            </h1>
            <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[11px] font-medium text-emerald-400 font-mono">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              ONLINE
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            تحليل بث الكاميرات المباشر بنماذج YOLO26 المستقلة (الكمامة، القفازات، الهاتف)
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={fetchLiveStats}
            title="تحديث البيانات لحظياً"
            className="flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition"
          >
            <RefreshCw className="h-3.5 w-3.5 text-slate-400" />
            <span>تحديث</span>
          </button>
          <button
            onClick={() => window.print()}
            title="طباعة تقرير العمليات"
            className="flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition"
          >
            <Printer className="h-3.5 w-3.5 text-slate-400" />
            <span>تقرير</span>
          </button>
          <Link
            href="/live"
            className="flex items-center gap-1.5 rounded-md bg-sky-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 transition"
          >
            <Video className="h-3.5 w-3.5" />
            <span>شاشة البث الكاملة</span>
          </Link>
        </div>
      </div>

      {/* 2. Key Operational Metrics Cards */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {/* Active Cameras */}
        <Link 
          href="/cameras" 
          className="rounded-lg border border-slate-800/80 bg-[#0d131f] p-4 hover:border-slate-700 transition block group"
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-medium">الكاميرات المتصلة</span>
            <Camera className="h-4 w-4 text-slate-400 group-hover:text-sky-400 transition-colors" />
          </div>
          <div className="mt-2.5 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-white tracking-tight">
              {stats.active_cameras}
            </span>
            <span className="text-xs text-slate-400">كاميرات نشطة</span>
          </div>
          <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1.5">
            {stats.active_cameras > 0 ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span className="text-emerald-400/90 font-medium">بث RTSP قيد التحليل الميداني</span>
              </>
            ) : (
              <span className="text-slate-400">لا توجد كاميرات متصلة حالياً</span>
            )}
          </div>
        </Link>

        {/* AI Models Metric */}
        <Link 
          href="/ai-services" 
          className="rounded-lg border border-slate-800/80 bg-[#0d131f] p-4 hover:border-slate-700 transition block group"
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-medium">نماذج YOLO26</span>
            <BrainCircuit className="h-4 w-4 text-slate-400 group-hover:text-sky-400 transition-colors" />
          </div>
          <div className="mt-2.5 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-white tracking-tight">
              3
            </span>
            <span className="text-xs text-slate-400">موديلات مستقلة</span>
          </div>
          <div className="mt-2 text-[11px] text-slate-400">
            الكمامة • القفازات والأيدي • الهاتف المحمول
          </div>
        </Link>

        {/* Total Today Detections */}
        <Link 
          href="/detections" 
          className="rounded-lg border border-slate-800/80 bg-[#0d131f] p-4 hover:border-slate-700 transition block group"
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-medium">إجمالي أحداث اليوم</span>
            <Activity className="h-4 w-4 text-slate-400 group-hover:text-sky-400 transition-colors" />
          </div>
          <div className="mt-2.5 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-white tracking-tight">
              {stats.total_detections}
            </span>
            <span className="text-xs text-slate-400">حدث مرصود</span>
          </div>
          <div className="mt-2 text-[11px] text-slate-400">
            محدث لحظياً مع كل إطار معالج
          </div>
        </Link>

        {/* Unread / Pending Action */}
        <Link 
          href="/detections" 
          className="rounded-lg border border-slate-800/80 bg-[#0d131f] p-4 hover:border-slate-700 transition block group"
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-medium">المخالفات المعلقة</span>
            <ShieldAlert className="h-4 w-4 text-slate-400 group-hover:text-red-400 transition-colors" />
          </div>
          <div className="mt-2.5 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-red-400 tracking-tight">
              {stats.unread_detections}
            </span>
            <span className="text-xs text-slate-400">تتطلب المراجعة</span>
          </div>
          <div className="mt-2 text-[11px] text-slate-400">
            تنبيهات سلامة تتطلب اعتماداً ميدانياً
          </div>
        </Link>
      </div>

      {/* 3. Live Feeds Operational Preview */}
      <div className="rounded-lg border border-slate-800/80 bg-[#0d131f] p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3.5">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${liveCameras.length > 0 ? 'bg-emerald-500' : 'bg-slate-600'}`} />
            <h2 className="text-xs sm:text-sm font-bold text-white">معاينة البث المباشر للكاميرات</h2>
            <span className="font-mono text-[11px] text-slate-400">
              ({liveCameras.length} قنوات)
            </span>
          </div>
          <Link 
            href="/live" 
            className="text-xs font-medium text-sky-400 hover:text-sky-300 flex items-center gap-1 transition"
          >
            <span>شاشة المراقبة المجمعة</span>
            <ChevronLeft className="h-3.5 w-3.5" />
          </Link>
        </div>

        {liveCameras.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-800 p-8 text-center">
            <Camera className="h-8 w-8 mx-auto mb-2 text-slate-600" />
            <p className="text-xs font-semibold text-slate-300">لا توجد قنوات بث مضافة حالياً</p>
            <p className="text-[11px] text-slate-400 mt-1 mb-3">يمكنك سحب قنوات مسجل DVR أو إضافة كاميرات RTSP من صفحة إدارة الكاميرات</p>
            <Link
              href="/cameras"
              className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 transition"
            >
              <span>إدارة وربط الكاميرات</span>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {liveCameras.slice(0, 4).map((cam) => {
              const ip = cam.dvr_ip || '192.168.8.57';
              const ch = cam.dvr_channel || 'CH1';
              return (
                <Link
                  key={cam.id}
                  href="/live"
                  className="group overflow-hidden rounded-md border border-slate-800 bg-[#070b14] flex flex-col justify-between hover:border-slate-700 transition"
                >
                  <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800/80 bg-slate-900/60 text-xs">
                    <span className="font-semibold text-slate-200 truncate">{cam.name}</span>
                    <span className="font-mono text-[10px] text-slate-400 px-1.5 py-0.5 rounded bg-slate-800">
                      {ch}
                    </span>
                  </div>
                  <div className="relative aspect-video w-full flex items-center justify-center overflow-hidden bg-black">
                    <LiveStreamPlayer
                      cameraId={cam.id}
                      cameraName={cam.name}
                      ip={ip}
                      channel={ch}
                      objectFit="cover"
                      className="w-full h-full select-none"
                      intervalMs={2000}
                    />
                    <div className="absolute top-2 right-2 text-[9px] font-mono text-emerald-400 bg-black/80 px-1.5 py-0.5 rounded border border-emerald-500/20 flex items-center gap-1 shadow pointer-events-none">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      LIVE
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. Real-time Incident Feed Table */}
      <div className="rounded-lg border border-slate-800/80 bg-[#0d131f] p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3.5">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-sky-400" />
            <h2 className="text-xs sm:text-sm font-bold text-white">سجل العمليات والإنذارات الحية</h2>
            <span className="font-mono text-[10px] rounded bg-slate-800 px-1.5 py-0.5 text-slate-400">
              {recentDetections.length} أحداث
            </span>
          </div>
          <Link 
            href="/detections" 
            className="text-xs font-medium text-sky-400 hover:text-sky-300 flex items-center gap-1 transition"
          >
            <span>عرض السجل كاملاً</span>
            <ChevronLeft className="h-3.5 w-3.5" />
          </Link>
        </div>

        {recentDetections.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-800 p-8 text-center text-slate-400">
            <CheckCircle2 className="h-6 w-6 mx-auto mb-2 text-emerald-500/60" />
            <p className="text-xs font-semibold text-slate-300">لا توجد مخالفات مسجلة حالياً</p>
            <p className="text-[11px] text-slate-400 mt-0.5">كاميرات المراقبة تعمل ونظام التحليل في وضع الجاهزية</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-medium">
                  <th className="pb-2.5 pr-3">التوقيت</th>
                  <th className="pb-2.5">الكاميرا</th>
                  <th className="pb-2.5">المخالفة / الحدث</th>
                  <th className="pb-2.5">نسبة الثقة</th>
                  <th className="pb-2.5">مستوى الخطورة</th>
                  <th className="pb-2.5 pl-3 text-left">المعاينة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {recentDetections.map((det) => (
                  <tr key={det.id} className="hover:bg-slate-800/30 transition">
                    <td className="py-2.5 pr-3 font-mono text-slate-400 text-[11px]" dir="ltr">
                      {det.detected_at
                        ? new Date(det.detected_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                        : 'الآن'}
                    </td>
                    <td className="py-2.5 font-medium text-slate-200">
                      {det.camera_name || 'كاميرا غير محددة'}
                    </td>
                    <td className="py-2.5 text-slate-100 font-semibold">
                      {det.type}
                    </td>
                    <td className="py-2.5 font-mono text-emerald-400">
                      {Math.round((det.confidence || 0.90) * 100)}%
                    </td>
                    <td className="py-2.5">
                      <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold border ${
                        det.severity === 'high'
                          ? 'border-red-500/20 bg-red-500/10 text-red-400'
                          : 'border-amber-500/20 bg-amber-500/10 text-amber-400'
                      }`}>
                        {det.severity === 'high' ? 'عالية' : 'متوسطة'}
                      </span>
                    </td>
                    <td className="py-2.5 pl-3 text-left">
                      <Link
                        href={`/detections?highlight=${det.id}`}
                        className="rounded border border-slate-700 bg-slate-800/60 px-2 py-1 text-[11px] font-medium text-slate-300 hover:text-white hover:bg-slate-700 transition"
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
    </div>
  );
}
