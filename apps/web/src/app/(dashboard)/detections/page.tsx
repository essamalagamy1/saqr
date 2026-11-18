'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  Search,
  Camera,
  Calendar,
  Share2,
  CheckCircle,
  Clock,
  Filter,
  Eye,
  Layers,
  ChevronDown,
  RefreshCw,
  PlusCircle,
  Check,
  Loader2,
  X,
  ExternalLink
} from 'lucide-react';
import { api } from '@/lib/api';

interface DetectionItem {
  id: string;
  type: string;
  camera_name?: string;
  camera_id?: string;
  zone_name?: string;
  branch_name?: string;
  branch_id?: string;
  confidence: number;
  detected_at?: string;
  severity: 'high' | 'medium' | 'low';
  is_acknowledged?: boolean;
}

function DetectionsContent() {
  const searchParams = useSearchParams();
  const initialSearch = searchParams?.get('search') || '';

  const [detections, setDetections] = useState<DetectionItem[]>([]);
  const [cameras, setCameras] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedService, setSelectedService] = useState('all');
  const [selectedCamera, setSelectedCamera] = useState('all');
  const [selectedBranch, setSelectedBranch] = useState('all');
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [isLive, setIsLive] = useState(false);
  const [taskSuccessId, setTaskSuccessId] = useState<string | null>(null);
  const [inspectModalItem, setInspectModalItem] = useState<DetectionItem | null>(null);

  const loadData = async () => {
    try {
      const [detData, camsData, branchesData] = await Promise.all([
        api.get<DetectionItem[]>('/detections/'),
        api.get<any[]>('/cameras/'),
        api.get<any[]>('/branches/'),
      ]);

      if (detData) {
        setDetections(detData);
        setIsLive(true);
      }
      if (camsData) setCameras(camsData);
      if (branchesData) setBranches(branchesData);
    } catch (e) {
      console.error('Error loading detections:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleAcknowledge = async (id: string) => {
    try {
      await api.patch(`/detections/${id}/acknowledge`, { acknowledged_by: 'مدير العمليات' });
      setDetections(prev => prev.map(d => d.id === id ? { ...d, is_acknowledged: true } : d));
    } catch (e) {
      console.error(e);
      alert('تعذر اعتماد الرصد');
    }
  };

  const handleConvertToTask = async (item: DetectionItem) => {
    try {
      await api.post('/tasks/', {
        branch_id: item.branch_id || (branches[0]?.id || '07c23347-85da-4b22-8c23-1b3a76c6713f'),
        detection_id: item.id,
        title: `متابعة مخالفة: ${item.type}`,
        description: `رصد آلي في ${item.camera_name || 'الكاميرا'} بنسبة ثقة ${Math.round(item.confidence * 100)}%`,
        priority: item.severity === 'high' ? 'high' : 'medium',
        assigned_to: 'مشرف الوردية'
      });
      setTaskSuccessId(item.id);
      setTimeout(() => setTaskSuccessId(null), 3000);
    } catch (e) {
      console.error(e);
      alert('تعذر تحويل الرصد إلى مهمة');
    }
  };

  const getColor = (type: string, sev: string) => {
    if (sev === 'high' || type.includes('قفازات') || type.includes('غطاء')) return '#ef4444';
    if (type.includes('تسكع') || sev === 'medium') return '#f59e0b';
    return '#3b82f6';
  };

  const filteredDetections = detections.filter(d => {
    if (selectedService === 'ppe' && !(d.type.includes('قفاز') || d.type.includes('غطاء'))) return false;
    if (selectedService === 'loitering' && !d.type.includes('تسكع')) return false;

    if (selectedCamera !== 'all' && d.camera_name !== selectedCamera) return false;
    if (selectedBranch !== 'all' && d.branch_name !== selectedBranch) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchType = d.type.toLowerCase().includes(q);
      const matchCam = (d.camera_name || '').toLowerCase().includes(q);
      const matchBranch = (d.branch_name || '').toLowerCase().includes(q);
      if (!matchType && !matchCam && !matchBranch) return false;
    }

    return true;
  });

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            سجل الاكتشافات الموحد
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            سجل الرصد الموحد لجميع المخالفات وأحداث الذكاء الاصطناعي مع التوثيق المصور
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={loadData} 
            title="تحديث القائمة"
            className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-slate-400 hover:text-white transition"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-400 border border-amber-500/20">
            {filteredDetections.length} نتيجة مسجلة {isLive ? '(محدث لحظياً)' : ''}
          </span>
        </div>
      </div>

      {/* Advanced Filter Box */}
      <div className="rounded-xl border border-slate-800/80 bg-[#0d1527] p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">الفرع</label>
            <select 
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-200 focus:outline-none focus:border-amber-500"
            >
              <option value="all">جميع الفروع</option>
              {branches.map(b => (
                <option key={b.id} value={b.name}>{b.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">الكاميرا</label>
            <select 
              value={selectedCamera}
              onChange={(e) => setSelectedCamera(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-200 focus:outline-none focus:border-amber-500"
            >
              <option value="all">جميع الكاميرات (All Cameras)</option>
              {cameras.map(c => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">نوع الخدمة</label>
            <select
              value={selectedService}
              onChange={(e) => setSelectedService(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-200 focus:outline-none focus:border-amber-500"
            >
              <option value="all">الكل (جميع الخدمات)</option>
              <option value="ppe">سلامة المطبخ (PPE)</option>
              <option value="loitering">كشف التسكع</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">الحالة</label>
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-300">
              جميع الحالات (معتمد وغير معتمد)
            </div>
          </div>
        </div>

        {/* Date and Search Bar */}
        <div className="flex flex-col sm:flex-row items-center gap-3 pt-2 border-t border-slate-800">
          <div className="relative flex-1 w-full">
            <Search className="absolute right-3 top-2.5 h-4 w-4 text-slate-500" />
            <input
              type="text"
              placeholder="بحث فوري في المخالفات بالكود أو النص..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-slate-900 py-2 pr-9 pl-4 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-300">
            <Calendar className="h-4 w-4 text-amber-500" />
            <span>اليوم — 17 نوفمبر 2026</span>
          </div>
        </div>
      </div>

      {/* Detections Card Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {loading ? (
          <div className="col-span-full py-16 text-center text-slate-500">
            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-amber-500" />
            جاري تحميل سجل الاكتشافات...
          </div>
        ) : filteredDetections.length === 0 ? (
          <div className="col-span-full py-16 text-center text-slate-500 rounded-xl border border-slate-800 bg-[#0d1527]">
            لا توجد مخالفات تطابق الفلتر أو البحث المختار
          </div>
        ) : (
          filteredDetections.map((item) => {
            const color = getColor(item.type, item.severity);
            return (
              <div
                key={item.id}
                className="group overflow-hidden rounded-xl border border-slate-800/80 bg-[#0d1527] shadow-md transition-all hover:border-slate-700 flex flex-col justify-between"
              >
                <div>
                  {/* Snapshot Image Container with Bounding Boxes */}
                  <div 
                    onClick={() => setInspectModalItem(item)}
                    className="relative aspect-video w-full bg-[#070b14] overflow-hidden cursor-pointer"
                  >
                    <div
                      className="absolute inset-8 rounded border-2 border-dashed flex items-start justify-start p-1 transition group-hover:scale-[1.02]"
                      style={{ borderColor: color, backgroundColor: `${color}15` }}
                    >
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white shadow"
                        style={{ backgroundColor: color }}
                      >
                        {item.type}
                      </span>
                    </div>

                    <div className="absolute top-2 right-2 bg-black/70 px-2 py-0.5 rounded text-[10px] text-slate-300 font-mono">
                      {item.camera_name || 'كاميرا المطعم'}
                    </div>

                    {item.is_acknowledged && (
                      <div className="absolute top-2 left-2 bg-emerald-500/90 text-black font-bold px-2 py-0.5 rounded text-[10px]">
                        ✓ تم الاعتماد
                      </div>
                    )}

                    <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition bg-black/80 px-2 py-0.5 rounded text-[10px] text-amber-400 flex items-center gap-1">
                      <Eye className="h-3 w-3" />
                      <span>تكبير اللقطة</span>
                    </div>
                  </div>

                  {/* Card Body */}
                  <div className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-slate-100">{item.type}</span>
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/20">
                        {Math.round((item.confidence || 0.95) * 100)}% ثقة
                      </span>
                    </div>

                    <div className="text-xs text-slate-400 space-y-1">
                      <div className="flex items-center justify-between">
                        <span>{item.camera_name || 'كاميرا الرصد المباشر'} {item.zone_name ? `• ${item.zone_name}` : ''}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        <span>{item.detected_at ? new Date(item.detected_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : 'الآن'}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Card Actions Footer */}
                <div className="p-4 pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
                  <button
                    onClick={() => handleConvertToTask(item)}
                    className="flex items-center gap-1 rounded-lg bg-slate-800 border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-700 transition"
                  >
                    {taskSuccessId === item.id ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                        <span className="text-emerald-400 font-bold">تم الإسناد!</span>
                      </>
                    ) : (
                      <>
                        <PlusCircle className="h-3.5 w-3.5 text-amber-500" />
                        <span>تحويل لمهمة</span>
                      </>
                    )}
                  </button>

                  {!item.is_acknowledged ? (
                    <button
                      onClick={() => handleAcknowledge(item.id)}
                      className="flex items-center gap-1 rounded-lg bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 text-xs font-semibold text-amber-400 hover:bg-amber-500/20 transition"
                    >
                      <CheckCircle className="h-3.5 w-3.5" />
                      <span>اعتماد</span>
                    </button>
                  ) : (
                    <span className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
                      <Check className="h-3 w-3" /> معتمدة
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Snapshot Preview Modal */}
      {inspectModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-in fade-in">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-[#0d1527] p-6 shadow-2xl text-right">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">{inspectModalItem.type}</h3>
                <p className="text-xs text-slate-400">{inspectModalItem.camera_name} • {inspectModalItem.branch_name}</p>
              </div>
              <button onClick={() => setInspectModalItem(null)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="relative mt-4 aspect-video w-full bg-black rounded-xl overflow-hidden flex items-center justify-center border border-slate-800">
              <div 
                className="absolute inset-12 rounded border-2 border-dashed flex items-start p-2"
                style={{ 
                  borderColor: getColor(inspectModalItem.type, inspectModalItem.severity), 
                  backgroundColor: `${getColor(inspectModalItem.type, inspectModalItem.severity)}20` 
                }}
              >
                <span className="bg-red-600 text-white font-bold text-xs px-2 py-0.5 rounded">
                  {inspectModalItem.type} ({Math.round(inspectModalItem.confidence * 100)}%)
                </span>
              </div>
              <Camera className="h-16 w-16 text-slate-800" />
            </div>

            <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
              <span>تاريخ الرصد: {inspectModalItem.detected_at ? new Date(inspectModalItem.detected_at).toLocaleString('ar-EG') : 'الآن'}</span>
              <button
                onClick={() => {
                  handleAcknowledge(inspectModalItem.id);
                  setInspectModalItem(null);
                }}
                className="rounded-lg bg-amber-500 px-4 py-2 font-bold text-black hover:bg-amber-400 transition"
              >
                اعتماد وتأكيد الإشعار
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DetectionsPage() {
  return (
    <Suspense fallback={
      <div className="py-20 text-center text-slate-500">
        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-amber-500" />
        جاري تحميل سجل الاكتشافات...
      </div>
    }>
      <DetectionsContent />
    </Suspense>
  );
}
