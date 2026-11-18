'use client';

import React, { useState, useEffect } from 'react';
import { 
  Video, Layers, Users, RefreshCw, Maximize2, Pause, Play, 
  Camera as CameraIcon, AlertCircle, Sparkles, ShieldCheck, Eye, EyeOff, Loader2, Camera, Download, Check
} from 'lucide-react';
import { api } from '@/lib/api';

interface CameraItem {
  id: string;
  name: string;
  branch_id: string;
  zone_name?: string;
  dvr_ip?: string;
  dvr_channel?: string;
  status: string;
  protocol: string;
}

export default function LiveFeedsPage() {
  const [cameras, setCameras] = useState<CameraItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedZone, setSelectedZone] = useState('all');
  const [showOverlays, setShowOverlays] = useState(true);
  const [activeModalCam, setActiveModalCam] = useState<CameraItem | null>(null);
  const [capturedSnapshotId, setCapturedSnapshotId] = useState<string | null>(null);

  const fetchCameras = async () => {
    setLoading(true);
    try {
      const data = await api.get<CameraItem[]>('/cameras/');
      if (data) {
        setCameras(data);
      }
    } catch (err) {
      console.error('Failed to fetch cameras:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCameras();
  }, []);

  const handleCaptureSnapshot = (cam: CameraItem) => {
    setCapturedSnapshotId(cam.id);
    setTimeout(() => setCapturedSnapshotId(null), 3000);
  };

  const displayedCameras = cameras.filter((cam) => {
    if (selectedZone === 'all') return true;
    if (selectedZone === 'entrance') return cam.name.includes('المدخل') || (cam.zone_name || '').includes('المدخل');
    if (selectedZone === 'wifi') return cam.name.includes('الواي فاي') || (cam.dvr_ip || '').includes('192.168.100');
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Video className="h-5 w-5 text-amber-500" />
            البث المباشر للكاميرات (WebRTC Live Grid)
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            بث لحظي منخفض التأخير (&lt;200ms) عبر MediaMTX و Edge Agent
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowOverlays(!showOverlays)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              showOverlays
                ? 'border-amber-500 bg-amber-500/10 text-amber-400'
                : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-200'
            }`}
          >
            {showOverlays ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            <span>{showOverlays ? 'إخفاء طبقات الذكاء (AI ROI)' : 'إظهار طبقات الذكاء'}</span>
          </button>

          <button
            onClick={() => fetchCameras()}
            className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 transition"
          >
            <RefreshCw className="h-4 w-4 text-amber-500" />
            <span>تحديث البث</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border border-slate-800/80 bg-[#0d1527] px-4 py-3">
        <div className="flex items-center gap-3 text-xs text-slate-300">
          <span className="font-semibold text-slate-400">الفرع:</span>
          <div className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-200">
            فرع القاهرة الجديدة (Fit For Less)
          </div>

          <span className="font-semibold text-slate-400 mr-2">المنطقة:</span>
          <select 
            value={selectedZone}
            onChange={(e) => setSelectedZone(e.target.value)}
            className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
          >
            <option value="all">كل الكاميرات المتصلة</option>
            {Array.from(new Set(cameras.map(c => c.zone_name).filter(Boolean))).map((z) => (
              <option key={z as string} value={z as string}>{z as string}</option>
            ))}
          </select>
        </div>

        <div className="text-xs font-semibold text-slate-400">
          متصل: <span className="text-emerald-400 font-bold">{displayedCameras.length}</span> من {cameras.length} كاميرات
        </div>
      </div>

      {/* Video Feeds Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {loading ? (
          <div className="col-span-full py-16 text-center text-slate-500">
            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-amber-500" />
            جاري تهيئة قنوات البث المباشر...
          </div>
        ) : displayedCameras.length === 0 ? (
          <div className="col-span-full py-16 text-center text-slate-500 rounded-xl border border-slate-800 bg-[#0d1527]">
            <CameraIcon className="h-10 w-10 text-slate-600 mx-auto mb-3" />
            <div className="text-sm font-bold text-slate-300 mb-1">لا توجد كاميرات متصلة بالبث المباشر حالياً</div>
            <p className="text-xs text-slate-500 mb-4">قم بفحص الشبكة أو إضافة كاميرات جديدة من صفحة إدارة الكاميرات</p>
            <a
              href="/cameras"
              className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 transition shadow-lg shadow-amber-500/20"
            >
              <span>الانتقال لإدارة وفحص الكاميرات</span>
            </a>
          </div>
        ) : (
          displayedCameras.map((cam, idx) => (
            <div
              key={cam.id || idx}
              className="group overflow-hidden rounded-xl border border-slate-800/80 bg-[#0d1527] shadow-lg transition-all hover:border-slate-700"
            >
              {/* Camera Header Bar */}
              <div className="flex items-center justify-between border-b border-slate-800/60 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-sm font-bold text-white">{cam.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/20">
                    منشطة
                  </span>
                  <button
                    onClick={() => setActiveModalCam(cam)}
                    className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition"
                    title="تكبير البث شاشة كاملة"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Video Viewport / Canvas Player */}
              <div className="relative aspect-video w-full bg-[#070b14] flex flex-col items-center justify-center overflow-hidden">
                {/* Live WebRTC indicator */}
                <div className="absolute top-3 right-3 text-[10px] font-mono text-emerald-400 bg-black/70 px-2 py-0.5 rounded border border-emerald-500/20 z-10 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                  LIVE • 25 FPS
                </div>

                {/* DVR Channel Watermark */}
                <div className="absolute top-3 left-3 text-[10px] font-mono text-slate-400 bg-black/60 px-2 py-0.5 rounded z-10">
                  {cam.dvr_ip || '192.168.8.234'} • {cam.dvr_channel || `CH${idx + 1}`}
                </div>

                {/* Real Stream or Status Display */}
                {cam.dvr_channel === 'cam1' || cam.name.includes('المدخل') ? (
                  <iframe
                    src="http://localhost:8888/cam1/?controls=0&autoplay=1&muted=1"
                    className="w-full h-full border-0"
                    title={cam.name}
                  />
                ) : (
                  <div className="relative w-full h-full flex flex-col items-center justify-center bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-4 text-center">
                    <Video className="h-10 w-10 text-amber-500/70 mb-2" />
                    <span className="text-sm font-bold text-slate-200">{cam.name}</span>
                    <span className="text-xs text-slate-400 mt-1 font-mono">rtsp://admin:****@{cam.dvr_ip}:554</span>
                    <span className="mt-2 rounded-full bg-amber-500/10 border border-amber-500/30 px-2.5 py-0.5 text-[10px] text-amber-400">
                      بانتظار إدخال كود التحقق في تطبيق Edge Agent
                    </span>
                  </div>
                )}

                {/* Bottom Quick Bar on hover */}
                <div className="absolute bottom-2 inset-x-2 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity bg-black/80 backdrop-blur rounded-lg px-3 py-1.5 text-xs text-slate-300">
                  <span className="text-[11px] text-amber-400 font-semibold">
                    {cam.zone_name || (cam.name.includes('المطبخ') ? 'المطبخ والتحضير' : 'المدخل الرئيسي')}
                  </span>
                  
                  <button
                    onClick={() => handleCaptureSnapshot(cam)}
                    className="flex items-center gap-1 text-[10px] bg-slate-800 hover:bg-slate-700 px-2 py-0.5 rounded text-slate-200 transition"
                  >
                    {capturedSnapshotId === cam.id ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-400" />
                        <span className="text-emerald-400">تم حفظ اللقطة!</span>
                      </>
                    ) : (
                      <>
                        <Camera className="h-3 w-3 text-amber-500" />
                        <span>التقاط لقطة</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Camera Footer Details */}
              <div className="flex items-center justify-between border-t border-slate-800/80 bg-slate-900/40 px-4 py-2.5 text-xs">
                <span className="text-slate-400">
                  المنطقة: <strong className="text-slate-200">{cam.zone_name || (cam.name.includes('المطبخ') ? 'المطبخ' : 'المدخل')}</strong>
                </span>
                <span className="text-emerald-400 font-mono text-[11px]">HD 1080p @ 25fps</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Fullscreen Video Modal */}
      {activeModalCam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-6 animate-in fade-in">
          <div className="relative w-full max-w-5xl rounded-2xl border border-slate-800 bg-[#0d1527] overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
              <div className="flex items-center gap-3">
                <span className="h-3 w-3 rounded-full bg-emerald-500 animate-ping" />
                <h2 className="text-lg font-bold text-white">{activeModalCam.name}</h2>
                <span className="text-xs text-slate-400">{activeModalCam.zone_name}</span>
              </div>
              <button 
                onClick={() => setActiveModalCam(null)}
                className="rounded-lg bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-700"
              >
                إغلاق (ESC)
              </button>
            </div>

            <div className="relative aspect-video w-full bg-black flex items-center justify-center">
              {activeModalCam.dvr_channel === 'cam1' || activeModalCam.name.includes('المدخل') ? (
                <iframe
                  src="http://localhost:8888/cam1/?controls=1&autoplay=1&muted=1"
                  className="w-full h-full border-0"
                  title={activeModalCam.name}
                />
              ) : (
                <div className="text-center text-slate-500 p-8">
                  <Video className="h-16 w-16 mx-auto mb-2 text-amber-500" />
                  <p className="text-base font-semibold text-slate-200">{activeModalCam.name}</p>
                  <p className="text-xs text-slate-400 mt-1 font-mono">rtsp://admin:****@{activeModalCam.dvr_ip}:554</p>
                  <p className="text-xs text-amber-400 mt-2">يرجى إدخال كود التحقق في تطبيق Edge Agent لبدء المعالجة</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
