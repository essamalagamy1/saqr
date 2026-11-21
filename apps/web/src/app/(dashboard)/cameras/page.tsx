'use client';

import React, { useState, useEffect } from 'react';
import { Camera, Plus, Video, Trash2, Power, CheckCircle, Clock, RefreshCw, Loader2, AlertCircle, Search, Radio, ShieldCheck, Download, Building2 } from 'lucide-react';
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

interface DvrChannelItem {
  channelNumber: number;
  name: string;
  status: string;
  resolution?: string;
  mainRtspUrl: string;
  subRtspUrl: string;
  dvrIp: string;
  dvrChannel: string;
  brand: string;
  selected?: boolean;
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
  const [selectedScanBranchId, setSelectedScanBranchId] = useState('');

  // Direct DVR / NVR Connect States
  const [showDvrModal, setShowDvrModal] = useState(false);
  const [dvrConnecting, setDvrConnecting] = useState(false);
  const [dvrImporting, setDvrImporting] = useState(false);
  const [dvrError, setDvrError] = useState('');
  const [dvrSuccess, setDvrSuccess] = useState('');
  const [dvrDeviceInfo, setDvrDeviceInfo] = useState<{ model?: string; totalChannels?: number } | null>(null);
  const [dvrChannels, setDvrChannels] = useState<DvrChannelItem[]>([]);
  const [dvrForm, setDvrForm] = useState({
    ip: '192.168.8.57',
    port: 80,
    rtspPort: 554,
    username: 'admin',
    password: '',
    brand: 'hikvision',
    branch_id: '',
    maxChannels: 16,
  });

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
        setSelectedScanBranchId((prev) => prev || branchesData[0].id);
        setDvrForm((prev) => ({ ...prev, branch_id: prev.branch_id || branchesData[0].id }));
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
      const branchId = selectedScanBranchId || branches[0]?.id || '';
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
    const branchId = selectedScanBranchId || branches[0]?.id || '';
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

  const handleConnectDvr = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setDvrConnecting(true);
    setDvrError('');
    setDvrSuccess('');
    setDvrChannels([]);
    setDvrDeviceInfo(null);

    try {
      const res = await fetch('/api/cameras/dvr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dvrForm),
      });
      const data = await res.json();
      if (!data.success) {
        setDvrError(data.error || 'تعذر الاتصال بجهاز الـ DVR. يرجى التحقق من عنوان الـ IP وبيانات الاعتماد.');
        return;
      }

      setDvrDeviceInfo(data.device || null);
      const mapped = (data.channels || []).map((ch: any) => ({
        ...ch,
        selected: true,
      }));
      setDvrChannels(mapped);
      setDvrSuccess(`تم الاتصال بنجاح واستخراج ${mapped.length} قناة بث من جهاز الـ DVR!`);
    } catch (err: any) {
      setDvrError('خطأ أثناء فحص الـ DVR: ' + err.message);
    } finally {
      setDvrConnecting(false);
    }
  };

  const handleToggleSelectAllDvr = (val: boolean) => {
    setDvrChannels((prev) => prev.map((c) => ({ ...c, selected: val })));
  };

  const handleToggleDvrChannel = (idx: number) => {
    setDvrChannels((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, selected: !c.selected } : c))
    );
  };

  const handleImportSelectedDvrChannels = async () => {
    const selected = dvrChannels.filter((c) => c.selected);
    if (selected.length === 0) {
      alert('يرجى تحديد قناة واحدة على الأقل للاستيراد');
      return;
    }

    setDvrImporting(true);
    const targetBranch = dvrForm.branch_id || (branches.length > 0 ? branches[0].id : '');

    try {
      let importedCount = 0;
      for (const ch of selected) {
        await api.post('/cameras/', {
          name: ch.name || `كاميرا ${ch.channelNumber} (DVR ${dvrForm.ip})`,
          branch_id: targetBranch,
          rtsp_url: ch.mainRtspUrl,
          dvr_ip: dvrForm.ip,
          dvr_channel: ch.dvrChannel || `CH${ch.channelNumber}`,
          protocol: 'rtsp',
        }).catch(() => {});
        importedCount++;
      }

      await loadData();
      setShowDvrModal(false);
      alert(`تم استيراد ${importedCount} قناة بنجاح من جهاز الـ DVR وتفعيلها للرصد والذكاء الاصطناعي!`);
    } catch (err: any) {
      alert('حدث خطأ أثناء الاستيراد: ' + err.message);
    } finally {
      setDvrImporting(false);
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
    if (!confirm(`هل أنت متأكد من حذف الكاميرا "${name}" نهائياً؟ لن تعود للظهور مرة أخرى.`)) return;

    try {
      // 1. Delete from Cloud Database
      await api.delete(`/cameras/${id}`);
      setCameras((prev) => prev.filter((c) => c.id !== id));

      // 2. Notify local Edge Agent on port 18800 so it drops it from electron-store
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1200);
        await fetch(`http://127.0.0.1:18800/api/cameras/${id}`, {
          method: 'DELETE',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
      } catch {}

      // 3. Clear memory frame cache
      await fetch('/api/cameras/stream', { method: 'DELETE' }).catch(() => {});
    } catch (err: any) {
      alert(err.message || 'تعذر حذف الكاميرا');
    }
  };

  const handleDeleteAllCameras = async () => {
    if (cameras.length === 0) {
      alert('لا توجد كاميرات لحذفها.');
      return;
    }
    if (!confirm(`⚠️ تحذير: هل أنت متأكد من حذف جميع الكاميرات (${cameras.length} كاميرا) نهائياً من المنصة وتطبيق المراقبة؟\nسيتم حذفها نهائياً ولن تعود للظهور مجدداً.`)) {
      return;
    }

    setLoading(true);
    try {
      // 1. Bulk delete all cameras on Cloud API
      await api.delete('/cameras/bulk/all');

      // 2. Wipe cameras from local Edge Agent store if running
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1500);
        await fetch('http://127.0.0.1:18800/api/cameras', {
          method: 'DELETE',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
      } catch {}

      // 3. Clear memory frame cache
      await fetch('/api/cameras/stream', { method: 'DELETE' }).catch(() => {});

      setCameras([]);
      alert('✅ تم حذف جميع الكاميرات بنجاح وتصفير القنوات.');
    } catch (err: any) {
      alert('حدث خطأ أثناء حذف الكاميرات: ' + (err.message || ''));
    } finally {
      setLoading(false);
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
            onClick={() => setShowDvrModal(true)}
            className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 px-4 py-2 text-xs font-bold text-black hover:from-amber-400 hover:to-amber-500 transition-all shadow-lg shadow-amber-500/25 border border-amber-400/40"
          >
            <Radio className="h-4 w-4 text-black" />
            <span>⚡ ربط واستيراد من DVR / NVR</span>
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
          {cameras.length > 0 && (
            <button
              onClick={handleDeleteAllCameras}
              title="حذف جميع الكاميرات دفعة واحدة"
              className="flex items-center gap-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 px-3.5 py-2 text-xs font-bold transition shadow-sm"
            >
              <Trash2 className="h-4 w-4" />
              <span>حذف الكل ({cameras.length})</span>
            </button>
          )}
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
                        onClick={() => setShowDvrModal(true)}
                        className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 px-4 py-2 text-xs font-bold text-black hover:from-amber-400 hover:to-amber-500 transition-colors shadow-lg shadow-amber-500/20"
                      >
                        <Radio className="h-4 w-4 text-black" />
                        <span>⚡ ربط واستيراد من DVR / NVR</span>
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
                      <td className="px-5 py-3.5">
                        {cam.branch_name || branches.find((b) => b.id === cam.branch_id)?.name || branches[0]?.name || 'الفرع الرئيسي'}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-slate-400">
                        {(cam.dvr_ip || (cam.rtsp_url ? (cam.rtsp_url.match(/@?([0-9.]+)/)?.[1] || '') : '')) || '192.168.8.234'} • {cam.dvr_channel || 'CH1'}
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

              {/* Branch Selector Dropdown */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3.5 space-y-2">
                <label className="block text-slate-200 font-bold text-xs flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-amber-500" />
                  <span>الفرع المستهدف لإضافة الكاميرات:</span>
                </label>
                <select
                  value={selectedScanBranchId}
                  onChange={(e) => setSelectedScanBranchId(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800/90 px-3 py-2 text-white text-xs focus:outline-none focus:border-amber-500"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-400">
                  سيتم تسجيل الكاميرات المكتشفة تلقائياً تحت هذا الفرع في حسابك وتظهر كشوفاتها باسم هذا الفرع.
                </p>
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

      {/* Direct DVR / NVR Connect Modal */}
      {showDvrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
          <div className="w-full max-w-3xl rounded-2xl border border-amber-500/30 bg-[#0b1222] p-6 shadow-2xl max-h-[92vh] flex flex-col">
            <div className="flex items-start justify-between pb-4 border-b border-slate-800">
              <div>
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400">
                    <Radio className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">
                      ربط واستيراد قنوات الـ DVR / NVR تلقائياً
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      استخراج قنوات الكاميرات المتصلة بجهاز التسجيل (16 أو 32 قناة) مع توليد روابط الـ Main & Sub RTSP للذكاء الاصطناعي
                    </p>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setShowDvrModal(false)}
                className="text-slate-400 hover:text-white p-1 text-lg rounded-lg hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto flex-1 py-4 space-y-4 pr-1">
              {dvrError && (
                <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{dvrError}</span>
                </div>
              )}

              {dvrSuccess && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-400">
                  <CheckCircle className="h-4 w-4 shrink-0" />
                  <span>{dvrSuccess}</span>
                </div>
              )}

              <form onSubmit={handleConnectDvr} className="space-y-3.5 bg-slate-900/40 border border-slate-800/80 rounded-xl p-4 text-xs">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">عنوان IP الخاص بالـ DVR</label>
                    <input
                      type="text"
                      required
                      placeholder="192.168.8.234"
                      value={dvrForm.ip}
                      onChange={(e) => setDvrForm({ ...dvrForm, ip: e.target.value })}
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-white font-mono focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">المنفذ HTTP (ISAPI / CGI)</label>
                    <input
                      type="number"
                      required
                      value={dvrForm.port}
                      onChange={(e) => setDvrForm({ ...dvrForm, port: parseInt(e.target.value) || 80 })}
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-white font-mono focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">منفذ البث RTSP</label>
                    <input
                      type="number"
                      required
                      value={dvrForm.rtspPort}
                      onChange={(e) => setDvrForm({ ...dvrForm, rtspPort: parseInt(e.target.value) || 554 })}
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-white font-mono focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">اسم المستخدم (DVR)</label>
                    <input
                      type="text"
                      required
                      placeholder="admin"
                      value={dvrForm.username}
                      onChange={(e) => setDvrForm({ ...dvrForm, username: e.target.value })}
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">كلمة المرور (DVR)</label>
                    <input
                      type="password"
                      placeholder="كلمة مرور الـ DVR"
                      value={dvrForm.password}
                      onChange={(e) => setDvrForm({ ...dvrForm, password: e.target.value })}
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">نوع الجهاز / الشركة المصنعة</label>
                    <select
                      value={dvrForm.brand}
                      onChange={(e) => setDvrForm({ ...dvrForm, brand: e.target.value })}
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                    >
                      <option value="hikvision">Hikvision / HiLook / EZVIZ (ISAPI)</option>
                      <option value="dahua">Dahua / Dahua-OEM (CGI)</option>
                      <option value="generic">ONVIF / Generic RTSP</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">أقصى عدد قنوات</label>
                    <select
                      value={dvrForm.maxChannels}
                      onChange={(e) => setDvrForm({ ...dvrForm, maxChannels: parseInt(e.target.value) || 16 })}
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                    >
                      <option value={4}>4 قنوات</option>
                      <option value={8}>8 قنوات</option>
                      <option value={16}>16 قناة (الافتراضي)</option>
                      <option value={32}>32 قناة</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">الفرع التابع له</label>
                    <select
                      value={dvrForm.branch_id}
                      onChange={(e) => setDvrForm({ ...dvrForm, branch_id: e.target.value })}
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                    >
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={dvrConnecting}
                    className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 px-5 py-2.5 font-bold text-black hover:from-amber-400 hover:to-amber-500 disabled:opacity-50 transition shadow-lg shadow-amber-500/20"
                  >
                    {dvrConnecting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin text-black" />
                        <span>جاري الاتصال وفحص القنوات...</span>
                      </>
                    ) : (
                      <>
                        <Radio className="h-4 w-4 text-black" />
                        <span>فحص واستخراج قنوات الـ DVR</span>
                      </>
                    )}
                  </button>
                </div>
              </form>

              {/* Channels List */}
              {dvrChannels.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-white">
                        القنوات المكتشفة: {dvrChannels.filter((c) => c.selected).length} من أصل {dvrChannels.length} قناة
                      </span>
                      {dvrDeviceInfo?.model && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400 font-mono">
                          موديل: {dvrDeviceInfo.model}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleToggleSelectAllDvr(true)}
                        className="text-[11px] text-amber-400 hover:underline"
                      >
                        تحديد الكل
                      </button>
                      <span className="text-slate-600">•</span>
                      <button
                        type="button"
                        onClick={() => handleToggleSelectAllDvr(false)}
                        className="text-[11px] text-slate-400 hover:underline"
                      >
                        إلغاء التحديد
                      </button>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400 text-[11px] flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 shrink-0" />
                    <span>
                      ميزة البث المزدوج (Dual-Streaming): سيتم ربط مسار الـ Main Stream للصور الأصلية والتوثيق، ومسار الـ Sub-Stream لمعالجة الذكاء الاصطناعي الخفيفة YOLOX لتوفير موارد المعالج.
                    </span>
                  </div>

                  <div className="max-h-64 overflow-y-auto space-y-2 divide-y divide-slate-800/40">
                    {dvrChannels.map((ch, idx) => {
                      const isSelected = !!ch.selected;
                      return (
                        <div
                          key={idx}
                          onClick={() => handleToggleDvrChannel(idx)}
                          className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition ${
                            isSelected
                              ? 'border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10'
                              : 'border-slate-800/70 bg-slate-900/30 hover:bg-slate-900/60 opacity-60'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {}}
                              className="rounded border-slate-700 text-amber-500 focus:ring-0 focus:ring-offset-0"
                            />
                            <div className="w-8 h-8 rounded-lg bg-slate-800 text-amber-400 flex items-center justify-center font-bold text-xs shrink-0 font-mono">
                              {ch.channelNumber}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-white text-xs">{ch.name}</span>
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">
                                  {ch.dvrChannel}
                                </span>
                              </div>
                              <div className="text-[10px] font-mono text-slate-500 truncate max-w-md mt-0.5" dir="ltr">
                                {ch.mainRtspUrl}
                              </div>
                            </div>
                          </div>

                          <div className="text-left shrink-0">
                            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
                              {ch.resolution || '1080p'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-800 bg-[#0b1222]">
              <button
                type="button"
                onClick={() => setShowDvrModal(false)}
                className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition"
              >
                إغلاق
              </button>

              {dvrChannels.length > 0 && (
                <button
                  type="button"
                  onClick={handleImportSelectedDvrChannels}
                  disabled={dvrImporting || dvrChannels.filter((c) => c.selected).length === 0}
                  className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50 transition shadow-lg shadow-emerald-600/25"
                >
                  {dvrImporting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-white" />
                      <span>جاري استيراد القنوات...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle className="h-4 w-4" />
                      <span>
                        استيراد القنوات المحددة ({dvrChannels.filter((c) => c.selected).length}) وحفظها بالمنصة
                      </span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
