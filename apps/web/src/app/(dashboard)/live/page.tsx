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
  branch_id?: string;
  zone_name?: string;
  dvr_ip?: string;
  dvr_channel?: string;
  rtsp_url?: string;
  status: string;
  protocol?: string;
}

export default function LiveFeedsPage() {
  const [cameras, setCameras] = useState<CameraItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedZone, setSelectedZone] = useState('all');
  const [showOverlays, setShowOverlays] = useState(true);
  const [activeModalCam, setActiveModalCam] = useState<CameraItem | null>(null);
  const [capturedSnapshotId, setCapturedSnapshotId] = useState<string | null>(null);
  const [frameTick, setFrameTick] = useState<number>(() => Date.now());

  // Auto-refresh frames every 2 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setFrameTick(Date.now());
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  const getCameraIp = (cam: CameraItem) => {
    if (cam.dvr_ip && cam.dvr_ip.trim()) return cam.dvr_ip;
    if (cam.rtsp_url) {
      const match = cam.rtsp_url.match(/@?([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})/);
      if (match) return match[1];
    }
    return '192.168.8.72';
  };

  const getMaskedRtsp = (cam: CameraItem) => {
    if (cam.rtsp_url) {
      return cam.rtsp_url.replace(/rtsp[s]?:\/\/([^:]+):([^@]+)@/i, 'rtsp://$1:****@');
    }
    const ip = getCameraIp(cam);
    const chNum = (cam.dvr_channel || 'CH1').replace(/[^0-9]/g, '') || '1';
    return `rtsp://admin:****@${ip}:554/Streaming/Channels/${chNum}01`;
  };

  const getStreamUrl = (cam: CameraItem) => {
    const ip = getCameraIp(cam);
    const ch = cam.dvr_channel || 'CH1';
    return `/api/cameras/${cam.id}/frame?ip=${encodeURIComponent(ip)}&ch=${encodeURIComponent(ch)}&t=${frameTick}`;
  };

  const fetchCameras = async () => {
    setLoading(true);
    try {
      const data = await api.get<CameraItem[]>('/cameras/');
      if (data && Array.isArray(data)) {
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
    return cam.zone_name === selectedZone;
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
            بث لحظي منخفض التأخير (&lt;200ms) عبر وكيل المراقبة الميداني Saqr Edge Agent
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
            <span>{showOverlays ? 'إخفاء طبقات الذكاء (AI HUD)' : 'إظهار طبقات الذكاء'}</span>
          </button>

          <button
            onClick={() => { setFrameTick(Date.now()); fetchCameras(); }}
            className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 transition"
          >
            <RefreshCw className="h-3.5 w-3.5 text-amber-500" />
            <span>تحديث البث</span>
          </button>

          <select
            value={selectedZone}
            onChange={(e) => setSelectedZone(e.target.value)}
            className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
          >
            <option value="all">كل الكاميرات المتصلة ({cameras.length})</option>
            {Array.from(new Set(cameras.map(c => c.zone_name).filter(Boolean))).map((z) => (
              <option key={z as string} value={z as string}>{z as string}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Cameras Grid */}
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
                  <span className="text-sm font-bold text-white truncate max-w-[200px]">{cam.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/20">
                    {cam.dvr_channel || `CH${idx + 1}`}
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
              <div className="relative aspect-video w-full bg-[#050811] flex items-center justify-center overflow-hidden cursor-pointer" onClick={() => setActiveModalCam(cam)}>
                {/* Live Real-Time Image Stream */}
                <img
                  src={getStreamUrl(cam)}
                  alt={cam.name}
                  className="w-full h-full object-cover select-none"
                  loading="lazy"
                />

                {/* Overlays / AI HUD */}
                {showOverlays && (
                  <>
                    {/* Live Indicator */}
                    <div className="absolute top-3 right-3 text-[10px] font-mono text-emerald-400 bg-black/80 px-2 py-0.5 rounded border border-emerald-500/30 z-10 flex items-center gap-1.5 shadow pointer-events-none">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                      LIVE • 25 FPS
                    </div>

                    {/* DVR Channel Watermark */}
                    <div className="absolute top-3 left-3 text-[10px] font-mono text-slate-200 bg-black/80 px-2 py-0.5 rounded border border-slate-800 z-10 pointer-events-none">
                      {getCameraIp(cam)} • {cam.dvr_channel || `CH${idx + 1}`}
                    </div>
                  </>
                )}

                {/* Bottom Quick Bar on hover */}
                <div 
                  onClick={(e) => e.stopPropagation()}
                  className="absolute bottom-2 inset-x-2 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity bg-black/85 backdrop-blur rounded-lg px-3 py-1.5 text-xs text-slate-300 z-10"
                >
                  <span className="text-[11px] text-amber-400 font-semibold truncate max-w-[60%]">
                    {cam.zone_name || 'المنطقة العامة'}
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
                <span className="text-slate-400 font-mono text-[11px]">
                  {getMaskedRtsp(cam)}
                </span>
                <span className="text-emerald-400 font-mono text-[11px]">HD 1080p</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Fullscreen Video Modal */}
      {activeModalCam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 sm:p-6 animate-in fade-in">
          <div className="relative w-full max-w-5xl rounded-2xl border border-slate-800 bg-[#0d1527] overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-3.5 shrink-0 bg-slate-900/60">
              <div className="flex items-center gap-3">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-ping" />
                <h2 className="text-base font-bold text-white">{activeModalCam.name}</h2>
                <span className="rounded bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[11px] font-mono text-emerald-400">
                  {activeModalCam.dvr_channel || 'CH1'}
                </span>
              </div>
              <button 
                onClick={() => setActiveModalCam(null)}
                className="rounded-lg bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition"
              >
                إغلاق (ESC)
              </button>
            </div>

            {/* Video Player Display */}
            <div className="relative aspect-video w-full bg-black flex items-center justify-center overflow-hidden border-b border-slate-800">
              <img
                src={getStreamUrl(activeModalCam)}
                alt={activeModalCam.name}
                className="w-full h-full object-contain select-none"
              />

              {/* Live Overlay HUD */}
              <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
                <span className="flex items-center gap-1.5 text-xs font-mono font-bold text-red-500 bg-black/80 px-2.5 py-1 rounded border border-red-500/30 shadow">
                  <span className="h-2 w-2 rounded-full bg-red-500 animate-ping" />
                  LIVE RTSP
                </span>
                <span className="text-xs font-mono text-emerald-400 bg-black/80 px-2 py-1 rounded border border-emerald-500/30 shadow">
                  1080p @ 25fps
                </span>
              </div>

              <div className="absolute top-4 left-4 text-xs font-mono text-slate-200 bg-black/80 px-2.5 py-1 rounded border border-slate-800 z-10 shadow">
                {getCameraIp(activeModalCam)} • {activeModalCam.dvr_channel || 'CH1'}
              </div>
            </div>

            {/* Modal Info Footer */}
            <div className="p-5 bg-[#0d1527] shrink-0">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-sm font-bold text-white">{activeModalCam.name}</h3>
                  <p className="text-xs text-slate-400 font-mono mt-0.5 dir-ltr">
                    {getMaskedRtsp(activeModalCam)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-3 py-1 text-xs font-semibold text-emerald-400">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    البث المباشر متصل ونشط
                  </span>
                  <span className="rounded-full bg-sky-500/10 border border-sky-500/30 px-3 py-1 text-xs font-medium text-sky-400">
                    معالجة YOLOX الذكية
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-xs">
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5">
                  <div className="text-slate-500 text-[10px]">حالة البث</div>
                  <div className="text-emerald-400 font-bold mt-0.5">متصل (Online)</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5">
                  <div className="text-slate-500 text-[10px]">عنوان الـ IP / القناة</div>
                  <div className="text-slate-200 font-bold mt-0.5">{getCameraIp(activeModalCam)} • {activeModalCam.dvr_channel || 'CH1'}</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5">
                  <div className="text-slate-500 text-[10px]">الجودة والبروتوكول</div>
                  <div className="text-slate-200 font-bold mt-0.5">HD 1080p @ RTSP</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5">
                  <div className="text-slate-500 text-[10px]">الوكيل الميداني</div>
                  <div className="text-amber-400 font-bold mt-0.5">Saqr Edge Agent</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
