'use client';

import React, { useState, useEffect } from 'react';
import { Camera, Plus, Video, Trash2, Power, CheckCircle, Clock, RefreshCw, Loader2, AlertCircle, Search, Radio, ShieldCheck, Download } from 'lucide-react';
import { api } from '@/lib/api';

interface CameraItem {
  id: string;
  name: string;
  branch_id?: string;
  branch_name?: string;
  zone_name?: string;
  dvr_ip?: string;
  dvr_channel?: string;
  protocol?: string;
  rtsp_url?: string;
  status: string;
  created_at?: string;
}

interface DiscoveredCamera {
  ip: string;
  port: number;
  brand: string;
  name: string;
  rtspUrl: string;
  needsCredentials: boolean;
  channel?: number;
}

interface BranchItem {
  id: string;
  name: string;
}

export default function CamerasPage() {
  const [cameras, setCameras] = useState<CameraItem[]>([]);
  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Agent Sync States
  const [syncingAgent, setSyncingAgent] = useState(false);
  const [syncBanner, setSyncBanner] = useState<{ type: 'success' | 'info' | 'error'; message: string } | null>(null);

  // Auto-Scan States
  const [showScanModal, setShowScanModal] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [discoveredCameras, setDiscoveredCameras] = useState<DiscoveredCamera[]>([]);
  const [addingIdx, setAddingIdx] = useState<Record<number, boolean>>({});
  const [scanMessage, setScanMessage] = useState('');

  const [newCamera, setNewCamera] = useState({
    name: '',
    branch_id: '',
    dvr_ip: '',
    dvr_channel: 'CH1',
    protocol: 'rtsp',
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const [camsData, branchesData] = await Promise.all([
        api.get<CameraItem[]>('/cameras/'),
        api.get<BranchItem[]>('/branches/'),
      ]);

      if (camsData) setCameras(camsData);
      if (branchesData && branchesData.length > 0) {
        setBranches(branchesData);
        setNewCamera((prev) => ({ ...prev, branch_id: prev.branch_id || branchesData[0].id }));
      }
    } catch (err: any) {
      console.error('Failed to load cameras:', err);
      setError('تعذر تحميل الكاميرات من الخادم');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSyncFromAgent = async () => {
    setSyncingAgent(true);
    setSyncBanner(null);

    // 1. If running on same machine/LAN where Edge Agent is running, try direct pull from local agent port 18800
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);
      const res = await fetch('http://127.0.0.1:18800/api/cameras', {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const localData = await res.json();
        if (localData.success && Array.isArray(localData.cameras) && localData.cameras.length > 0) {
          const branchId = branches[0]?.id || '';
          for (const c of localData.cameras) {
            const channelStr = c.channel ? `CH${c.channel}` : (c.dvrChannel || 'CH1');
            await api.post('/cameras/', {
              name: c.name,
              branch_id: branchId,
              rtsp_url: c.rtspUrl,
              dvr_ip: c.dvrIp || '',
              dvr_channel: channelStr,
              protocol: 'rtsp',
            }).catch(() => {});
          }
        }
      }
    } catch {
      // Local port unreachable or mixed-content: fallback to querying cloud DB directly
    }

    // 2. Fetch latest cameras from cloud database
    try {
      const camsData = await api.get<CameraItem[]>('/cameras/');
      if (camsData) {
        setCameras(camsData);
        if (camsData.length > 0) {
          setSyncBanner({
            type: 'success',
            message: `تم جلب ومزامنة الكاميرات بنجاح! تم رصد ${camsData.length} كاميرا مسجلة وجاهزة للمراقبة.`,
          });
        } else {
          setSyncBanner({
            type: 'info',
            message: 'لم يتم العثور على كاميرات مسجلة من التطبيق حتى الآن. تأكد من فتح تطبيق Saqr Edge Agent على جهاز الويندوز وإضافة الكاميرات أو فحصها، ثم الضغط على "مزامنة مع المنصة".',
          });
        }
      }
    } catch (err: any) {
      setSyncBanner({
        type: 'error',
        message: 'تعذر جلب الكاميرات من الخادم: ' + (err.message || ''),
      });
    } finally {
      setSyncingAgent(false);
    }
  };

  const handleStartScan = async () => {
    setShowScanModal(true);
    setScanning(true);
    setScanMessage('جاري فحص الشبكة المحلية عبر بروتوكولات (SADP / ONVIF / Port 554)...');
    setDiscoveredCameras([]);
    setAddingIdx({});

    try {
      const res = await fetch('/api/cameras/scan');
      const data = await res.json();
      if (data.success) {
        setDiscoveredCameras(data.cameras || []);
        if ((data.cameras || []).length === 0) {
          setScanMessage('لم يتم العثور على أي كاميرات على نطاق الشبكة الحالي.');
        } else {
          setScanMessage(`تم اكتشاف ${data.cameras.length} كاميرا على شبكتك المحلية!`);
        }
      } else {
        setScanMessage(data.error || 'فشل فحص كاميرات الشبكة');
      }
    } catch (err: any) {
      setScanMessage('تعذر إتمام الفحص: ' + err.message);
    } finally {
      setScanning(false);
    }
  };

  const handleAddDiscoveredCamera = async (cam: DiscoveredCamera, idx: number) => {
    setAddingIdx((prev) => ({ ...prev, [idx]: true }));
    try {
      const branchId = branches[0]?.id || '';
      const channelStr = cam.channel ? `CH${cam.channel}` : 'CH1';
      await api.post('/cameras/', {
        name: cam.name,
        branch_id: branchId,
        rtsp_url: cam.rtspUrl,
        dvr_ip: cam.ip,
        dvr_channel: channelStr,
        protocol: 'rtsp',
      });
      await loadData();
    } catch (err: any) {
      alert(err.message || 'حدث خطأ أثناء إضافة الكاميرا');
    } finally {
      setAddingIdx((prev) => ({ ...prev, [idx]: false }));
    }
  };

  const handleAddAllDiscovered = async () => {
    const branchId = branches[0]?.id || '';
    setScanning(true);
    setScanMessage('جاري إضافة جميع الكاميرات المكتشفة إلى قاعدة البيانات...');

    try {
      for (const cam of discoveredCameras) {
        const channelStr = cam.channel ? `CH${cam.channel}` : 'CH1';
        await api.post('/cameras/', {
          name: cam.name,
          branch_id: branchId,
          rtsp_url: cam.rtspUrl,
          dvr_ip: cam.ip,
          dvr_channel: channelStr,
          protocol: 'rtsp',
        }).catch(() => {});
      }
      await loadData();
      setShowScanModal(false);
      alert(`تمت إضافة جميع الكاميرات المكتشفة بنجاح وتزامنها مع المنصة وتطبيق المراقبة!`);
    } catch (err: any) {
      alert('خطأ أثناء الإضافة: ' + err.message);
    } finally {
      setScanning(false);
    }
  };

  const handleAddCamera = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCamera.name) return;
    setSubmitting(true);
    setError('');

    try {
      const branchId = newCamera.branch_id || (branches.length > 0 ? branches[0].id : '');
      if (!branchId) {
        setError('يرجى اختيار فرع صالح');
        setSubmitting(false);
        return;
      }

      await api.post('/cameras/', {
        name: newCamera.name,
        branch_id: branchId,
        dvr_ip: newCamera.dvr_ip,
        dvr_channel: newCamera.dvr_channel,
        protocol: newCamera.protocol,
      });

      setShowAddModal(false);
      setNewCamera({
        name: '',
        branch_id: branches[0]?.id || '',
        dvr_ip: '',
        dvr_channel: `CH${cameras.length + 1}`,
        protocol: 'rtsp',
      });
      await loadData();
    } catch (err: any) {
      setError(err.message || 'حدث خطأ أثناء إضافة الكاميرا');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteCamera = async (id: string, name: string) => {
    if (!confirm(`هل أنت متأكد من حذف الكاميرا "${name}" نهائياً؟`)) return;

    try {
      await api.delete(`/cameras/${id}`);
      setCameras((prev) => prev.filter((c) => c.id !== id));
    } catch (err: any) {
      alert(err.message || 'تعذر حذف الكاميرا');
    }
  };

  const handleToggleStatus = async (cam: CameraItem) => {
    const newStatus = cam.status === 'active' ? 'disconnected' : 'active';
    try {
      await api.patch(`/cameras/${cam.id}/status`, { status: newStatus });
      setCameras((prev) =>
        prev.map((c) => (c.id === cam.id ? { ...c, status: newStatus } : c))
      );
    } catch (err: any) {
      alert('تعذر تحديث حالة الكاميرا');
    }
  };

  return (
    <div className="space-y-6">
      {/* Title & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Camera className="h-5 w-5 text-amber-500" />
            إدارة الكاميرات وقنوات البث
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            ربط كاميرات الـ IP الميدانية وأجهزة الـ DVR / NVR المحلية بالذكاء الاصطناعي
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadData}
            title="تحديث القائمة"
            className="p-2 rounded-lg bg-slate-800 text-slate-400 hover:text-white transition"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={handleSyncFromAgent}
            disabled={syncingAgent}
            title="جلب ومزامنة الكاميرات المسجلة في تطبيق صقر الميداني (Edge Agent)"
            className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-700 px-4 py-2 text-xs font-bold text-white hover:from-emerald-500 hover:to-teal-600 transition-all shadow-lg shadow-emerald-600/25 border border-emerald-500/30 disabled:opacity-50"
          >
            {syncingAgent ? (
              <Loader2 className="h-4 w-4 animate-spin text-white" />
            ) : (
              <Download className="h-4 w-4 text-emerald-200" />
            )}
            <span>{syncingAgent ? 'جاري جلب الكاميرات...' : '📥 جلب كاميرات تطبيق Edge Agent'}</span>
          </button>
          <button
            onClick={handleStartScan}
            className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-sky-600 to-sky-700 px-4 py-2 text-xs font-bold text-white hover:from-sky-500 hover:to-sky-600 transition-all shadow-lg shadow-sky-600/25 border border-sky-500/30"
          >
            <Search className="h-4 w-4" />
            <span>🔍 فحص واكتشاف كاميرات الشبكة</span>
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-black hover:bg-amber-400 transition-colors shadow-lg shadow-amber-500/20"
          >
            <Plus className="h-4 w-4" />
            <span>إضافة يدوية</span>
          </button>
        </div>
      </div>

      {syncBanner && (
        <div
          className={`flex items-center justify-between gap-2 rounded-lg border p-3 text-xs transition-all ${
            syncBanner.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              : syncBanner.type === 'error'
              ? 'border-red-500/30 bg-red-500/10 text-red-400'
              : 'border-sky-500/30 bg-sky-500/10 text-sky-400'
          }`}
        >
          <div className="flex items-center gap-2">
            {syncBanner.type === 'success' ? (
              <CheckCircle className="h-4 w-4 shrink-0 text-emerald-400" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            <span>{syncBanner.message}</span>
          </div>
          <button
            onClick={() => setSyncBanner(null)}
            className="text-slate-400 hover:text-white px-1 font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Table Card */}
      <div className="overflow-hidden rounded-xl border border-slate-800/80 bg-[#0d1527]">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-900/60 border-b border-slate-800 text-slate-400">
              <tr>
                <th className="px-5 py-3.5 font-semibold">اسم الكاميرا</th>
                <th className="px-5 py-3.5 font-semibold">الفرع</th>
                <th className="px-5 py-3.5 font-semibold">عنوان الـ DVR / القناة</th>
                <th className="px-5 py-3.5 font-semibold">البروتوكول</th>
                <th className="px-5 py-3.5 font-semibold">الحالة</th>
                <th className="px-5 py-3.5 font-semibold text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-amber-500" />
                    جاري تحميل الكاميرات من قاعدة البيانات...
                  </td>
                </tr>
              ) : cameras.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500">
                    <p className="mb-4 text-sm text-slate-400">لم يتم تسجيل أي كاميرا حتى الآن في قاعدة البيانات.</p>
                    <div className="flex flex-wrap items-center justify-center gap-3">
                      <button
                        onClick={handleSyncFromAgent}
                        disabled={syncingAgent}
                        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 transition-colors shadow-lg shadow-emerald-600/20 disabled:opacity-50"
                      >
                        {syncingAgent ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                        <span>📥 جلب كاميرات تطبيق Edge Agent</span>
                      </button>
                      <button
                        onClick={handleStartScan}
                        className="inline-flex items-center gap-2 rounded-lg bg-sky-600/90 px-4 py-2 text-xs font-bold text-white hover:bg-sky-500 transition-colors shadow-lg shadow-sky-600/20"
                      >
                        <Search className="h-4 w-4" />
                        <span>🔍 فحص واكتشاف كاميرات الشبكة الآن</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                cameras.map((cam) => {
                  const isActive = cam.status === 'active';
                  return (
                    <tr key={cam.id} className="hover:bg-slate-850/50 transition-colors">
                      <td className="px-5 py-3.5 font-bold text-white flex items-center gap-2">
                        <Video className={`h-4 w-4 ${isActive ? 'text-amber-500' : 'text-slate-600'}`} />
                        <span>{cam.name}</span>
                      </td>
                      <td className="px-5 py-3.5">{cam.branch_name || 'فرع القاهرة الجديدة'}</td>
                      <td className="px-5 py-3.5 font-mono text-slate-400">
                        {cam.dvr_ip || '192.168.8.234'} • {cam.dvr_channel || 'CH1'}
                      </td>
                      <td className="px-5 py-3.5 font-mono uppercase">{cam.protocol || 'RTSP'}</td>
                      <td className="px-5 py-3.5">
                        <button
                          onClick={() => handleToggleStatus(cam)}
                          title="اضغط لتغيير الحالة"
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border transition ${
                            isActive
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                              : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                          }`}
                        >
                          {isActive ? '● منشطة' : '○ متوقفة'}
                        </button>
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleToggleStatus(cam)}
                            title={isActive ? 'إيقاف البث' : 'تفعيل البث'}
                            className={`p-1.5 rounded-lg border transition ${
                              isActive
                                ? 'bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/20'
                                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            <Power className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteCamera(cam.id, cam.name)}
                            title="حذف الكاميرا نهائياً"
                            className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-red-400 hover:border-red-500/30 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Network Auto-Scan Modal */}
      {showScanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl border border-slate-800 bg-[#0d1527] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-slate-900/60">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Search className="h-5 w-5 text-sky-400" />
                فحص واكتشاف كاميرات الشبكة المحلية
              </h3>
              <button
                onClick={() => setShowScanModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg transition"
              >
                ✕
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              {/* Status Box */}
              <div className="flex items-center gap-3 p-3.5 rounded-xl border border-sky-500/25 bg-sky-500/10 text-xs">
                {scanning ? (
                  <Loader2 className="h-5 w-5 animate-spin text-sky-400 shrink-0" />
                ) : (
                  <CheckCircle className="h-5 w-5 text-emerald-400 shrink-0" />
                )}
                <div>
                  <div className="font-bold text-white">{scanMessage}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    بروتوكولات الفحص: SADP (EZVIZ / Hikvision) • ONVIF WS-Discovery • مسح منافذ RTSP (554)
                  </div>
                </div>
              </div>

              {/* Discovered Cameras List */}
              <div className="space-y-2.5">
                {discoveredCameras.map((cam, idx) => {
                  const isAlreadyAdded = cameras.some((c) => {
                    if (c.name && c.name === cam.name) return true;
                    if (c.dvr_ip && c.dvr_ip === cam.ip) {
                      const chStr = cam.channel ? `CH${cam.channel}` : 'CH1';
                      if (c.dvr_channel && c.dvr_channel.toUpperCase() === chStr) return true;
                      if (c.rtsp_url && cam.rtspUrl) {
                        return c.rtsp_url.includes(`/ch${cam.channel}/`) || c.rtsp_url.includes(`/${cam.channel}01`);
                      }
                      return !cam.channel;
                    }
                    return false;
                  });
                  const isAdding = addingIdx[idx];
                  const isHikEzviz = cam.brand.includes('EZVIZ') || cam.brand.includes('Hikvision');

                  return (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-3.5 rounded-xl border border-slate-800/80 bg-slate-900/40 hover:bg-slate-900/80 transition"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center shrink-0">
                          <Video className="h-4 w-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white text-xs">{cam.name}</span>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                                isHikEzviz
                                  ? 'bg-sky-500/15 text-sky-400 border-sky-500/30'
                                  : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                              }`}
                            >
                              {cam.brand}
                            </span>
                          </div>
                          <div className="text-[11px] font-mono text-slate-400 mt-0.5" dir="ltr">
                            {cam.rtspUrl}
                          </div>
                        </div>
                      </div>

                      <div>
                        {isAlreadyAdded ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-lg">
                            ✓ مضافة بالفعل
                          </span>
                        ) : (
                          <button
                            onClick={() => handleAddDiscoveredCamera(cam, idx)}
                            disabled={isAdding || scanning}
                            className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-50 transition"
                          >
                            {isAdding && <Loader2 className="h-3 w-3 animate-spin" />}
                            <span>+ إضافة للمراقبة</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between p-4 border-t border-slate-800 bg-slate-900/60">
              <button
                onClick={handleStartScan}
                disabled={scanning}
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white transition disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${scanning ? 'animate-spin' : ''}`} />
                <span>إعادة الفحص</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowScanModal(false)}
                  className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition"
                >
                  إغلاق
                </button>
                {discoveredCameras.length > 0 && (
                  <button
                    onClick={handleAddAllDiscovered}
                    disabled={scanning}
                    className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50 transition shadow-lg shadow-emerald-600/20"
                  >
                    <span>إضافة جميع الكاميرات المكتشفة ({discoveredCameras.length})</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Camera Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-[#0d1527] p-6 shadow-2xl">
            <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
              <Camera className="h-5 w-5 text-amber-500" />
              إضافة كاميرا ميدانية جديدة
            </h3>

            <form onSubmit={handleAddCamera} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">اسم الكاميرا</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: Fit 4 Less 4 - صالة الزبائن"
                  value={newCamera.name}
                  onChange={(e) => setNewCamera({ ...newCamera, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">الفرع التابع له الكاميرا</label>
                <select
                  value={newCamera.branch_id}
                  onChange={(e) => setNewCamera({ ...newCamera, branch_id: e.target.value })}
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">عنوان IP للـ DVR / الكاميرا</label>
                  <input
                    type="text"
                    placeholder="192.168.8.234"
                    value={newCamera.dvr_ip}
                    onChange={(e) => setNewCamera({ ...newCamera, dvr_ip: e.target.value })}
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-white font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">رقم القناة (Channel)</label>
                  <input
                    type="text"
                    placeholder="CH10"
                    value={newCamera.dvr_channel}
                    onChange={(e) => setNewCamera({ ...newCamera, dvr_channel: e.target.value })}
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-white font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="mt-6 flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-lg bg-slate-800 px-4 py-2 text-slate-300 hover:bg-slate-700"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-2 font-bold text-black hover:bg-amber-400 disabled:opacity-50"
                >
                  {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>حفظ وربط الكاميرا</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
