'use client';

import React, { useState, useEffect, Suspense, useMemo } from 'react';
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
  Trash2,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  AlertCircle
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
  snapshot_url?: string;
  bounding_boxes?: any;
  metadata?: any;
}

interface BoundingBox {
  x: number; // percentage 0-100
  y: number; // percentage 0-100
  width: number; // percentage 0-100
  height: number; // percentage 0-100
  label: string;
  color: string;
}

// Translate detection types and labels to professional Arabic & English tags
function getDetectionDetails(type: string, severity: string) {
  const t = (type || '').toLowerCase();
  
  if (t.includes('hairnet') || t.includes('غطاء')) {
    return {
      serviceTitle: 'مراقبة معدات السلامة في المطبخ',
      tagEn: 'No hairnet',
      tagAr: 'عدم ارتداء غطاء الرأس',
      badgeColor: 'border-red-800/60 bg-red-950/80 text-red-300',
      accentColor: '#ef4444',
      category: 'Kitchen PPE'
    };
  }
  if (t.includes('mask') || t.includes('كمامة')) {
    return {
      serviceTitle: 'مراقبة معدات السلامة في المطبخ',
      tagEn: 'No mask',
      tagAr: 'عدم ارتداء الكمامة',
      badgeColor: 'border-rose-800/60 bg-rose-950/80 text-rose-300',
      accentColor: '#f43f5e',
      category: 'Kitchen PPE'
    };
  }
  if (t.includes('loitering') || t.includes('تسكع') || t.includes('lingering')) {
    return {
      serviceTitle: 'كشف التسكع في الممرات والمناطق الحيوية',
      tagEn: 'Lingering 7:00',
      tagAr: 'كشف التسكع والانتظار',
      badgeColor: 'border-amber-800/60 bg-amber-950/80 text-amber-300',
      accentColor: '#f59e0b',
      category: 'Loitering'
    };
  }
  if (t.includes('glove') || t.includes('قفاز')) {
    return {
      serviceTitle: 'مراقبة النظافة والقفازات',
      tagEn: 'No gloves',
      tagAr: 'عدم ارتداء القفازات',
      badgeColor: 'border-orange-800/60 bg-orange-950/80 text-orange-300',
      accentColor: '#ea580c',
      category: 'Hygiene PPE'
    };
  }
  if (t.includes('phone') || t.includes('هاتف')) {
    return {
      serviceTitle: 'رصد استخدام الهواتف أثناء العمل',
      tagEn: 'Phone usage',
      tagAr: 'استخدام الهاتف المحمول',
      badgeColor: 'border-purple-800/60 bg-purple-950/80 text-purple-300',
      accentColor: '#a855f7',
      category: 'Compliance'
    };
  }

  // Default person / general detection
  return {
    serviceTitle: 'رصد حركة وتواجد أفراد بالمنشأة',
    tagEn: 'Person detected',
    tagAr: 'رصد شخص',
    badgeColor: 'border-blue-800/60 bg-blue-950/80 text-blue-300',
    accentColor: '#3b82f6',
    category: 'Motion & Presence'
  };
}

// Parse bounding boxes safely from various formats into percentages
function parseBoundingBoxes(rawBoxes: any, detectionType: string, confidence: number): BoundingBox[] {
  const details = getDetectionDetails(detectionType, 'medium');

  if (!rawBoxes) {
    return [
      {
        x: 32,
        y: 20,
        width: 36,
        height: 60,
        label: details.tagEn,
        color: details.accentColor
      }
    ];
  }

  try {
    let parsed = typeof rawBoxes === 'string' ? JSON.parse(rawBoxes) : rawBoxes;
    if (typeof parsed === 'string') parsed = JSON.parse(parsed);

    if (Array.isArray(parsed) && parsed.length > 0) {
      if (typeof parsed[0] === 'number' && parsed.length >= 4) {
        parsed = [parsed];
      }

      return parsed.map((item: any, idx: number) => {
        if (Array.isArray(item) && item.length >= 4) {
          const [x1, y1, x2, y2] = item;
          const isPixel = x2 > 1.5 || y2 > 1.5;
          const frameW = isPixel ? 1920 : 1;
          const frameH = isPixel ? 1080 : 1;

          const left = Math.max(0, Math.min(100, (x1 / frameW) * 100));
          const top = Math.max(0, Math.min(100, (y1 / frameH) * 100));
          const width = Math.max(4, Math.min(100 - left, ((x2 - x1) / frameW) * 100));
          const height = Math.max(6, Math.min(100 - top, ((y2 - y1) / frameH) * 100));

          return {
            x: left,
            y: top,
            width,
            height,
            label: idx === 0 ? details.tagEn : 'Person',
            color: idx === 0 ? details.accentColor : '#64748b'
          };
        } else if (typeof item === 'object' && item !== null) {
          const x = item.x ?? item.left ?? 30;
          const y = item.y ?? item.top ?? 20;
          const w = item.width ?? item.w ?? 40;
          const h = item.height ?? item.h ?? 60;
          const isPixel = (x + w) > 1.5;
          const frameW = isPixel ? 1920 : 1;
          const frameH = isPixel ? 1080 : 1;

          return {
            x: Math.max(0, Math.min(100, (x / frameW) * 100)),
            y: Math.max(0, Math.min(100, (y / frameH) * 100)),
            width: Math.max(4, Math.min(100, (w / frameW) * 100)),
            height: Math.max(6, Math.min(100, (h / frameH) * 100)),
            label: item.label || details.tagEn,
            color: item.color || details.accentColor
          };
        }
        return { x: 30, y: 20, width: 40, height: 60, label: details.tagEn, color: details.accentColor };
      });
    }
  } catch (e) {
    console.warn('Failed to parse bounding boxes:', e);
  }

  return [
    {
      x: 32,
      y: 20,
      width: 36,
      height: 60,
      label: details.tagEn,
      color: details.accentColor
    }
  ];
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
  const [inspectIndex, setInspectIndex] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

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
      } else {
        setDetections([]);
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

  // Single detection delete
  const handleDeleteSingle = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('هل تريد حذف هذا الاكتشاف نهائياً؟')) return;

    setDeletingId(id);
    try {
      await api.delete(`/detections/${id}`);
      setDetections(prev => prev.filter(d => d.id !== id));
      showToast('تم حذف الاكتشاف بنجاح');
      if (inspectIndex !== null) {
        setInspectIndex(null);
      }
    } catch (err: any) {
      console.error('Delete error:', err);
      alert('فشل في حذف الاكتشاف: ' + (err.message || 'خطأ غير معروف'));
    } finally {
      setDeletingId(null);
    }
  };

  // Delete all detections
  const handleDeleteAll = async () => {
    setIsDeletingAll(true);
    try {
      await api.delete('/detections/all');
      setDetections([]);
      setShowDeleteAllModal(false);
      setInspectIndex(null);
      showToast('تم مسح جميع الاكتشافات بنجاح');
    } catch (err: any) {
      console.error('Delete all error:', err);
      alert('تعذر حذف جميع الاكتشافات: ' + (err.message || 'خطأ في الخادم'));
    } finally {
      setIsDeletingAll(false);
    }
  };

  const handleAcknowledge = async (id: string) => {
    try {
      await api.patch(`/detections/${id}/acknowledge`, { acknowledged_by: 'مدير العمليات' });
      setDetections(prev => prev.map(d => d.id === id ? { ...d, is_acknowledged: true } : d));
      showToast('تم اعتماد الرصد بنجاح');
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
      showToast('تم تحويل الرصد إلى مهمة متابعة');
      setTimeout(() => setTaskSuccessId(null), 3000);
    } catch (e) {
      console.error(e);
      alert('تعذر تحويل الرصد إلى مهمة');
    }
  };

  const filteredDetections = useMemo(() => {
    return detections.filter(d => {
      if (selectedService === 'ppe' && !(d.type.includes('قفاز') || d.type.includes('غطاء') || d.type.includes('hairnet') || d.type.includes('mask'))) return false;
      if (selectedService === 'loitering' && !(d.type.includes('تسكع') || d.type.includes('loitering') || d.type.includes('lingering'))) return false;

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
  }, [detections, selectedService, selectedCamera, selectedBranch, searchQuery]);

  const activeInspectItem = inspectIndex !== null && filteredDetections[inspectIndex] ? filteredDetections[inspectIndex] : null;

  const navigateInspect = (direction: 'prev' | 'next') => {
    if (inspectIndex === null || filteredDetections.length === 0) return;
    if (direction === 'prev') {
      setInspectIndex((inspectIndex - 1 + filteredDetections.length) % filteredDetections.length);
    } else {
      setInspectIndex((inspectIndex + 1) % filteredDetections.length);
    }
  };

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 left-6 z-50 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/90 px-4 py-3 text-sm font-semibold text-emerald-200 shadow-2xl backdrop-blur-md animate-in slide-in-from-bottom-5">
          <CheckCircle className="h-4 w-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Page Header */}
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

        <div className="flex items-center gap-2 flex-wrap">
          {/* Delete All Button */}
          <button
            onClick={() => setShowDeleteAllModal(true)}
            disabled={detections.length === 0}
            title="حذف جميع الاكتشافات من قاعدة البيانات"
            className="flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/20 hover:text-red-300 disabled:opacity-40 disabled:pointer-events-none transition shadow-sm"
          >
            <Trash2 className="h-4 w-4 text-red-500" />
            <span>حذف جميع الاكتشافات</span>
          </button>

          {/* Refresh Button */}
          <button 
            onClick={loadData} 
            title="تحديث القائمة"
            className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-slate-400 hover:text-white transition"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-amber-400' : ''}`} />
          </button>

          {/* Count Badge */}
          <span className="rounded-full bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-400 border border-amber-500/20">
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
            <span>اليوم — {new Date().toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
          </div>
        </div>
      </div>

      {/* Detections Card Grid Matching User Design */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {loading ? (
          <div className="col-span-full py-20 text-center text-slate-500">
            <Loader2 className="h-7 w-7 animate-spin mx-auto mb-3 text-amber-500" />
            <p className="text-sm font-semibold">جاري تحميل سجل الاكتشافات المباشر...</p>
          </div>
        ) : filteredDetections.length === 0 ? (
          <div className="col-span-full py-20 text-center text-slate-500 rounded-2xl border border-slate-800 bg-[#0d1527] space-y-2">
            <Camera className="h-10 w-10 mx-auto text-slate-700 mb-2" />
            <p className="text-sm font-semibold text-slate-400">لا توجد اكتشافات مسجلة حالياً</p>
            <p className="text-xs text-slate-600">سيتم ظهور أي رصد جديد يتم التقاطه بواسطة وكيل الذكاء الاصطناعي هنا فوراً</p>
          </div>
        ) : (
          filteredDetections.map((item, index) => {
            const details = getDetectionDetails(item.type, item.severity);
            const boxes = parseBoundingBoxes(item.bounding_boxes, item.type, item.confidence);

            return (
              <div
                key={item.id}
                className="group overflow-hidden rounded-xl border border-slate-800/90 bg-[#0a0f1d] shadow-lg transition-all hover:border-slate-700 flex flex-col justify-between"
                style={{ borderTop: `3px solid ${details.accentColor}` }}
              >
                <div>
                  {/* Snapshot Container with Interactive Bounding Boxes */}
                  <div 
                    onClick={() => setInspectIndex(index)}
                    className="relative aspect-video w-full bg-[#050811] overflow-hidden cursor-pointer select-none"
                  >
                    {item.snapshot_url ? (
                      <img
                        src={item.snapshot_url}
                        alt={item.type}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900/60 text-slate-700">
                        <Camera className="h-10 w-10 mb-1" />
                        <span className="text-[10px]">لا تتوفر لقطة</span>
                      </div>
                    )}

                    {/* Dark gradient vignette */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/40 pointer-events-none" />

                    {/* Top Watermark Bar */}
                    <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none text-[10px] font-mono text-slate-200">
                      <span className="font-semibold text-white bg-black/60 px-1.5 py-0.5 rounded backdrop-blur-xs">
                        {details.category}
                      </span>
                      <span className="bg-black/60 px-1.5 py-0.5 rounded backdrop-blur-xs">
                        {item.detected_at ? new Date(item.detected_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : 'الآن'}
                      </span>
                    </div>

                    {/* Drawn Bounding Boxes with Tag Badges */}
                    {boxes.map((box, bIdx) => (
                      <div
                        key={bIdx}
                        className="absolute rounded border-2 transition-all pointer-events-none"
                        style={{
                          left: `${box.x}%`,
                          top: `${box.y}%`,
                          width: `${box.width}%`,
                          height: `${box.height}%`,
                          borderColor: box.color,
                          backgroundColor: `${box.color}15`,
                        }}
                      >
                        {/* Attached Tag Label */}
                        <div 
                          className="absolute -top-6 left-0 bg-slate-950/90 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow-md border border-slate-700/80 flex items-center gap-1.5 whitespace-nowrap"
                        >
                          <span 
                            className="w-1.5 h-1.5 rounded-full animate-pulse"
                            style={{ backgroundColor: box.color }}
                          />
                          <span>{box.label}</span>
                        </div>
                      </div>
                    ))}

                    {/* Bottom Watermark Overlay */}
                    <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between pointer-events-none">
                      <span className="bg-slate-950/80 text-[10px] text-slate-300 font-bold px-2 py-0.5 rounded border border-slate-800">
                        Today #{index + 1}
                      </span>
                      <span className="bg-slate-950/80 text-[10px] text-slate-400 font-mono px-2 py-0.5 rounded border border-slate-800">
                        {item.camera_name || 'Camera 01'}
                      </span>
                    </div>
                  </div>

                  {/* Sub-image Action & Tag Bar */}
                  <div className="bg-[#11192d] px-3 py-2 flex items-center justify-between border-b border-slate-800/70">
                    {/* Action Icon Buttons */}
                    <div className="flex items-center gap-1">
                      {/* Red Trash Delete Button */}
                      <button
                        onClick={(e) => handleDeleteSingle(e, item.id)}
                        disabled={deletingId === item.id}
                        title="حذف هذا الاكتشاف"
                        className="p-1 rounded-md text-red-500 hover:text-red-400 hover:bg-red-500/15 transition disabled:opacity-50"
                      >
                        {deletingId === item.id ? (
                          <Loader2 className="h-4 w-4 animate-spin text-red-400" />
                        ) : (
                          <Trash2 className="h-4 w-4 text-red-500" />
                        )}
                      </button>

                      {/* Orange Camera Snapshot Button */}
                      <button
                        onClick={() => setInspectIndex(index)}
                        title="عرض اللقطة كاملة وتفاصيل الرصد"
                        className="p-1 rounded-md text-amber-500 hover:text-amber-400 hover:bg-amber-500/15 transition"
                      >
                        <Camera className="h-4 w-4" />
                      </button>

                      {/* Blue Tune / Sliders Button */}
                      <button
                        title="إعدادات الحساسية والفلترة"
                        className="p-1 rounded-md text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/15 transition"
                      >
                        <SlidersHorizontal className="h-4 w-4" />
                      </button>

                      {/* Purple Share Button */}
                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText(window.location.href);
                          showToast('تم نسخ رابط الرصد للمشاركة');
                        }}
                        title="مشاركة الرصد"
                        className="p-1 rounded-md text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/15 transition"
                      >
                        <Share2 className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Right Badges: Confidence & Violation Category */}
                    <div className="flex items-center gap-1.5">
                      {/* Confidence badge */}
                      <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                        {Math.round((item.confidence || 0.96) * 100)}%
                      </span>

                      {/* Violation Arabic Pill */}
                      <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${details.badgeColor}`}>
                        {details.tagAr}
                      </span>
                    </div>
                  </div>

                  {/* Card Metadata Body */}
                  <div className="p-3.5 space-y-1 text-right">
                    <h3 className="text-xs font-bold text-slate-100 line-clamp-1">
                      {details.serviceTitle}
                    </h3>

                    <div className="text-[11px] text-slate-400 flex items-center justify-start gap-1 font-medium">
                      <span>{item.camera_name || 'كاميرا 1'}</span>
                      <span>•</span>
                      <span>{item.zone_name || 'Zone 1'}</span>
                      <span>•</span>
                      <span className="text-slate-300">{item.branch_name || 'فرع القاهرة'}</span>
                    </div>

                    <div className="text-[10px] text-slate-500 flex items-center justify-start gap-1 pt-1">
                      <Clock className="h-3 w-3 text-slate-500" />
                      <span>
                        {item.detected_at 
                          ? new Date(item.detected_at).toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) 
                          : 'الآن'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card Conversion & Status Footer */}
                <div className="p-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs bg-[#070b15]">
                  <button
                    onClick={() => handleConvertToTask(item)}
                    className="flex items-center gap-1 rounded-md bg-slate-800/80 border border-slate-700/80 px-2 py-1 text-[11px] font-medium text-slate-300 hover:text-white hover:bg-slate-700 transition"
                  >
                    {taskSuccessId === item.id ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-400" />
                        <span className="text-emerald-400 font-bold">تم الإسناد!</span>
                      </>
                    ) : (
                      <>
                        <PlusCircle className="h-3 w-3 text-amber-500" />
                        <span>تحويل لمهمة</span>
                      </>
                    )}
                  </button>

                  {!item.is_acknowledged ? (
                    <button
                      onClick={() => handleAcknowledge(item.id)}
                      className="flex items-center gap-1 rounded-md bg-amber-500/10 border border-amber-500/20 px-2 py-1 text-[11px] font-semibold text-amber-400 hover:bg-amber-500/20 transition"
                    >
                      <CheckCircle className="h-3 w-3" />
                      <span>اعتماد</span>
                    </button>
                  ) : (
                    <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                      <Check className="h-3 w-3" /> معتمدة
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Snapshot Preview & Carousel Modal Matching User Design */}
      {activeInspectItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-md p-3 sm:p-6 animate-in fade-in">
          <div className="relative w-full max-w-5xl rounded-2xl border border-slate-800 bg-[#0a0f1e] shadow-2xl overflow-hidden flex flex-col max-h-[95vh]">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-800 bg-[#0d1527]">
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-white flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  {getDetectionDetails(activeInspectItem.type, activeInspectItem.severity).category}
                </span>
                <span className="text-xs text-slate-400">
                  {getDetectionDetails(activeInspectItem.type, activeInspectItem.severity).serviceTitle}
                </span>
              </div>

              <div className="flex items-center gap-4">
                <span className="text-xs text-slate-400 font-mono">
                  {activeInspectItem.detected_at 
                    ? new Date(activeInspectItem.detected_at).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'medium' }) 
                    : 'الآن'}
                </span>
                
                {/* Delete button inside modal */}
                <button
                  onClick={(e) => handleDeleteSingle(e, activeInspectItem.id)}
                  title="حذف هذا الاكتشاف"
                  className="p-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/15 transition border border-red-500/30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>

                <button 
                  onClick={() => setInspectIndex(null)} 
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Modal Main Image with Navigation Arrows */}
            <div className="relative flex-1 bg-black flex items-center justify-center min-h-[380px] max-h-[60vh] overflow-hidden">
              {/* Prev / Next Arrows */}
              <button
                onClick={() => navigateInspect('prev')}
                className="absolute left-4 z-20 p-2 rounded-full bg-black/60 hover:bg-black/90 text-white border border-slate-700 transition backdrop-blur-sm"
                title="السابق"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>

              <button
                onClick={() => navigateInspect('next')}
                className="absolute right-4 z-20 p-2 rounded-full bg-black/60 hover:bg-black/90 text-white border border-slate-700 transition backdrop-blur-sm"
                title="التالي"
              >
                <ChevronRight className="h-6 w-6" />
              </button>

              {/* Main Snapshot */}
              <div className="relative w-full h-full flex items-center justify-center">
                {activeInspectItem.snapshot_url ? (
                  <img
                    src={activeInspectItem.snapshot_url}
                    alt={activeInspectItem.type}
                    className="max-h-[58vh] w-auto max-w-full object-contain"
                  />
                ) : (
                  <div className="py-24 text-slate-700 flex flex-col items-center">
                    <Camera className="h-16 w-16 mb-2" />
                    <span>لا تتوفر لقطة مسجلة</span>
                  </div>
                )}

                {/* Accurate Bounding Box Overlay */}
                {parseBoundingBoxes(activeInspectItem.bounding_boxes, activeInspectItem.type, activeInspectItem.confidence).map((box, idx) => (
                  <div
                    key={idx}
                    className="absolute rounded border-2 transition-all pointer-events-none"
                    style={{
                      left: `${box.x}%`,
                      top: `${box.y}%`,
                      width: `${box.width}%`,
                      height: `${box.height}%`,
                      borderColor: box.color,
                      backgroundColor: `${box.color}15`,
                    }}
                  >
                    <div 
                      className="absolute -top-7 left-0 bg-slate-950/95 text-white text-xs font-bold px-2.5 py-1 rounded shadow-lg border border-slate-700 flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <span 
                        className="w-2 h-2 rounded-full animate-pulse"
                        style={{ backgroundColor: box.color }}
                      />
                      <span>{box.label}</span>
                    </div>
                  </div>
                ))}

                {/* Overlays */}
                <div className="absolute bottom-3 left-6 bg-slate-950/80 px-3 py-1 rounded text-xs font-bold text-white border border-slate-800">
                  Today #{inspectIndex !== null ? inspectIndex + 1 : 1}
                </div>
                <div className="absolute bottom-3 right-6 bg-slate-950/80 px-3 py-1 rounded text-xs font-mono text-slate-300 border border-slate-800">
                  {activeInspectItem.camera_name || 'Camera 01'}
                </div>
              </div>
            </div>

            {/* Bottom Thumbnails Carousel Strip */}
            <div className="px-6 py-3 bg-[#070b14] border-t border-slate-800/80 flex items-center justify-center gap-2 overflow-x-auto">
              {filteredDetections.slice(0, 10).map((thumb, idx) => (
                <button
                  key={thumb.id}
                  onClick={() => setInspectIndex(idx)}
                  className={`relative w-16 h-11 rounded-lg overflow-hidden border-2 transition-all shrink-0 ${
                    inspectIndex === idx 
                      ? 'border-amber-400 scale-105 shadow-md shadow-amber-500/20' 
                      : 'border-slate-800 opacity-60 hover:opacity-100 hover:border-slate-600'
                  }`}
                >
                  {thumb.snapshot_url ? (
                    <img src={thumb.snapshot_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-slate-900 flex items-center justify-center">
                      <Camera className="h-4 w-4 text-slate-600" />
                    </div>
                  )}
                </button>
              ))}
            </div>

            {/* Modal Bottom Actions Bar */}
            <div className="px-6 py-3.5 bg-[#0d1527] border-t border-slate-800 flex items-center justify-between text-xs">
              <div className="text-slate-400">
                <span>الكاميرا: <strong className="text-white">{activeInspectItem.camera_name || 'Camera 01'}</strong></span>
                <span className="mx-2">•</span>
                <span>الفرع: <strong className="text-white">{activeInspectItem.branch_name || 'الفرع الرئيسي'}</strong></span>
                <span className="mx-2">•</span>
                <span>نسبة الثقة: <strong className="text-emerald-400">{Math.round(activeInspectItem.confidence * 100)}%</strong></span>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleConvertToTask(activeInspectItem)}
                  className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 font-semibold text-slate-200 hover:text-white hover:bg-slate-700 transition flex items-center gap-1.5"
                >
                  <PlusCircle className="h-4 w-4 text-amber-500" />
                  <span>تحويل لمهمة عمل</span>
                </button>

                <button
                  onClick={() => {
                    handleAcknowledge(activeInspectItem.id);
                  }}
                  className="rounded-lg bg-amber-500 px-4 py-2 font-bold text-black hover:bg-amber-400 transition flex items-center gap-1.5"
                >
                  <CheckCircle className="h-4 w-4" />
                  <span>اعتماد وتأكيد الإشعار</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete All Confirmation Modal */}
      {showDeleteAllModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl border border-red-500/40 bg-[#0d1527] p-6 shadow-2xl text-right space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <div className="p-2 rounded-full bg-red-500/15 border border-red-500/30">
                <AlertCircle className="h-6 w-6 text-red-500" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">حذف جميع الاكتشافات نهائياً</h3>
                <p className="text-xs text-red-300">تحذير أمني — هذا الإجراء لا يمكن التراجع عنه</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              هل أنت متأكد من رغبتك في حذف جميع الاكتشافات المسجلة ({detections.length} رصد)؟ سيتم حذف كافة السجلات واللقطات المصورة المرفقة بها من قاعدة البيانات بصورة دائمة.
            </p>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => setShowDeleteAllModal(false)}
                disabled={isDeletingAll}
                className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition"
              >
                تراجع وإلغاء
              </button>

              <button
                onClick={handleDeleteAll}
                disabled={isDeletingAll}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-500 transition flex items-center gap-1.5 shadow-lg shadow-red-600/30 disabled:opacity-50"
              >
                {isDeletingAll ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>جاري المسح...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" />
                    <span>تأكيد حذف الكل</span>
                  </>
                )}
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
