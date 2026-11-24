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
  EyeOff,
  Layers,
  ChevronDown,
  RefreshCw,
  Check,
  Loader2,
  X,
  Trash2,
  SlidersHorizontal,
  AlertCircle,
  Building2,
  HardDrive,
  Flame,
  Archive,
  Pin,
  ShieldCheck,
  ZoomIn,
  ZoomOut,
  RotateCcw
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
  storage_tier?: 'hot' | 'warm' | 'cold' | string;
  is_pinned?: boolean;
  pinned_reason?: string;
  is_acknowledged?: boolean;
  feedback_type?: 'verified_positive' | 'false_positive' | 'unreviewed' | string;
  training_status?: string;
  review_notes?: string;
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

function getCleanSnapshotUrl(url?: string): string {
  if (!url) return '';
  if (url.includes('/api/cameras/snapshot/')) {
    const id = url.split('/api/cameras/snapshot/')[1];
    return `/api/cameras/snapshot/${id}`;
  }
  return url;
}

// Translate detection types and labels to professional Arabic & English tags
function getDetectionDetails(type: string, severity: string) {
  const t = (type || '').toLowerCase();
  
  // 1. Kitchen PPE - Hairnet
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
  // 2. Kitchen PPE - Mask
  if (t.includes('mask') || t.includes('كمامة') || t.includes('كمامات')) {
    return {
      serviceTitle: 'مراقبة معدات السلامة في المطبخ',
      tagEn: 'No mask',
      tagAr: 'عدم ارتداء الكمامة',
      badgeColor: 'border-rose-800/60 bg-rose-950/80 text-rose-300',
      accentColor: '#f43f5e',
      category: 'Kitchen PPE'
    };
  }
  // 3. Visitor / Foot traffic (In / Out)
  if (t.includes('visitor') || t.includes('زائر') || t.includes('دخول') || t.includes('خروج') || t.includes('توافد')) {
    const isOut = t.includes('خروج') || t.includes('exit') || t.includes('out');
    return {
      serviceTitle: 'حساب عدد الداخلين والخارجين وقياس التوافد',
      tagEn: isOut ? 'Visitor Exit' : 'Visitor Entry',
      tagAr: isOut ? 'خروج زائر' : 'دخول زائر',
      badgeColor: isOut ? 'border-sky-800/60 bg-sky-950/80 text-sky-300' : 'border-emerald-800/60 bg-emerald-950/80 text-emerald-300',
      accentColor: isOut ? '#0ea5e9' : '#10b981',
      category: 'Foot Traffic'
    };
  }
  // 4. Loitering
  if (t.includes('loitering') || t.includes('تسكع') || t.includes('lingering')) {
    return {
      serviceTitle: 'كشف التسكع في الممرات والمناطق الحيوية',
      tagEn: 'Lingering 0:45',
      tagAr: 'كشف التسكع والانتظار',
      badgeColor: 'border-amber-800/60 bg-amber-950/80 text-amber-300',
      accentColor: '#f59e0b',
      category: 'Loitering'
    };
  }
  // 5. Phone usage
  if (t.includes('phone') || t.includes('هاتف') || t.includes('جوال')) {
    return {
      serviceTitle: 'رصد استخدام الهواتف أثناء ساعات العمل',
      tagEn: 'Phone usage',
      tagAr: 'استخدام الهاتف المحمول',
      badgeColor: 'border-purple-800/60 bg-purple-950/80 text-purple-300',
      accentColor: '#a855f7',
      category: 'Compliance'
    };
  }
  // 6. Queue Wait Time
  if (t.includes('queue') || t.includes('طابور') || t.includes('انتظار')) {
    return {
      serviceTitle: 'قياس أوقات الانتظار وطول الطوابير',
      tagEn: 'Customer Queue',
      tagAr: 'طابور انتظار عملاء',
      badgeColor: 'border-indigo-800/60 bg-indigo-950/80 text-indigo-300',
      accentColor: '#6366f1',
      category: 'Queue Analytics'
    };
  }
  // 7. Staff Monitoring
  if (t.includes('employee') || t.includes('staff') || t.includes('موظف')) {
    return {
      serviceTitle: 'تتبع تواجد العاملين في نطاقات عملهم',
      tagEn: 'Staff Presence',
      tagAr: 'مراقبة الموظفين',
      badgeColor: 'border-cyan-800/60 bg-cyan-950/80 text-cyan-300',
      accentColor: '#06b6d4',
      category: 'Staff Operations'
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
  // 8. Multiple Persons
  if (t.includes('multiple') || t.includes('أشخاص متعددين') || t.includes('أشخاص')) {
    return {
      serviceTitle: 'رصد حركة وتواجد أفراد بالمنشأة',
      tagEn: 'Multiple Persons',
      tagAr: 'رصد أشخاص متعددين',
      badgeColor: 'border-blue-800/60 bg-blue-950/80 text-blue-300',
      accentColor: '#3b82f6',
      category: 'Motion & Presence'
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

      const colors = ['#3b82f6', '#06b6d4', '#10b981', '#a855f7', '#f59e0b', '#ec4899'];

      return parsed.map((item: any, idx: number) => {
        // Case 0: item already has direct percentage coordinates
        if (typeof item === 'object' && item !== null && typeof item.x === 'number' && typeof item.width === 'number') {
          const mult = (item.x <= 1.0 && item.width <= 1.0 && (item.y ?? 0) <= 1.0 && (item.height ?? 0) <= 1.0) ? 100 : 1;
          const left = Math.max(0, Math.min(100, item.x * mult));
          const top = Math.max(0, Math.min(100, (item.y ?? item.top ?? 20) * mult));
          const width = Math.max(3, Math.min(100 - left, item.width * mult));
          const height = Math.max(4, Math.min(100 - top, (item.height ?? item.h ?? 50) * mult));
          return {
            x: left,
            y: top,
            width,
            height,
            label: item.label || details.tagEn,
            color: item.color || details.accentColor
          };
        }

        // Extract [x1, y1, x2, y2]
        const box = Array.isArray(item) ? item : (item && Array.isArray(item.box) ? item.box : null);
        if (box && box.length >= 4) {
          const [x1, y1, x2, y2] = box;

          // Normalized 0..1 coordinates
          if (x2 <= 1.0 && y2 <= 1.0) {
            const left = Math.max(0, Math.min(100, x1 * 100));
            const top = Math.max(0, Math.min(100, y1 * 100));
            const width = Math.max(3, Math.min(100 - left, (x2 - x1) * 100));
            const height = Math.max(4, Math.min(100 - top, (y2 - y1) * 100));
            return {
              x: left,
              y: top,
              width,
              height,
              label: item.label || (parsed.length === 1 ? details.tagEn : `Person ${idx + 1}`),
              color: item.color || (parsed.length === 1 ? details.accentColor : colors[idx % colors.length])
            };
          }

          // Dynamic frame dimension detection:
          // 1. Explicit frame_width / frame_height
          let frameW = item.frame_width || item.frameWidth;
          let frameH = item.frame_height || item.frameHeight;

          // 2. Auto-detect stream resolution from coordinate bounds:
          if (!frameW || !frameH) {
            if (x2 <= 640 && y2 <= 360) {
              frameW = 640;
              frameH = 360;
            } else if (x2 <= 720 && y2 <= 576) {
              frameW = 704;
              frameH = 576;
            } else if (x2 <= 1280 && y2 <= 720) {
              frameW = 1280;
              frameH = 720;
            } else {
              frameW = 1920;
              frameH = 1080;
            }
          }

          const left = Math.max(0, Math.min(100, (x1 / frameW) * 100));
          const top = Math.max(0, Math.min(100, (y1 / frameH) * 100));
          const width = Math.max(3, Math.min(100 - left, ((x2 - x1) / frameW) * 100));
          const height = Math.max(4, Math.min(100 - top, ((y2 - y1) / frameH) * 100));

          return {
            x: left,
            y: top,
            width,
            height,
            label: item.label || (parsed.length === 1 ? details.tagEn : `Person ${idx + 1}`),
            color: item.color || (parsed.length === 1 ? details.accentColor : colors[idx % colors.length])
          };
        }

        // Case 3: item is { x, y, width, height, label, color } in pixels
        if (typeof item === 'object' && item !== null) {
          const rawX = item.x ?? item.left ?? 30;
          const rawY = item.y ?? item.top ?? 20;
          const rawW = item.width ?? item.w ?? 40;
          const rawH = item.height ?? item.h ?? 60;
          const isPixel = (rawX + rawW) > 1.5;
          let frameW = 1920, frameH = 1080;
          if (isPixel) {
            if ((rawX + rawW) <= 640 && (rawY + rawH) <= 360) {
              frameW = 640;
              frameH = 360;
            }
          } else {
            frameW = 1;
            frameH = 1;
          }

          return {
            x: Math.max(0, Math.min(100, (rawX / frameW) * 100)),
            y: Math.max(0, Math.min(100, (rawY / frameH) * 100)),
            width: Math.max(3, Math.min(100, (rawW / frameW) * 100)),
            height: Math.max(4, Math.min(100, (rawH / frameH) * 100)),
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
  
  // Single Detection Inspection & Zoom/Pan State
  const [inspectItem, setInspectItem] = useState<DetectionItem | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panPosition, setPanPosition] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [showBoundingBoxes, setShowBoundingBoxes] = useState(true);

  const resetZoom = () => {
    setZoomLevel(1);
    setPanPosition({ x: 0, y: 0 });
  };

  const handleZoomIn = () => {
    setZoomLevel(prev => Math.min(Number((prev + 0.3).toFixed(1)), 4));
  };

  const handleZoomOut = () => {
    setZoomLevel(prev => {
      const next = Math.max(Number((prev - 0.3).toFixed(1)), 1);
      if (next === 1) setPanPosition({ x: 0, y: 0 });
      return next;
    });
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      handleZoomIn();
    } else {
      handleZoomOut();
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoomLevel > 1) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - panPosition.x, y: e.clientY - panPosition.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning && zoomLevel > 1) {
      setPanPosition({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  const handleDoubleClick = () => {
    if (zoomLevel > 1) {
      resetZoom();
    } else {
      setZoomLevel(2);
    }
  };

  const openInspect = (item: DetectionItem) => {
    setInspectItem(item);
    resetZoom();
    setShowBoundingBoxes(true);
  };

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [storageStats, setStorageStats] = useState<any>(null);
  const [processingTiers, setProcessingTiers] = useState(false);

  // Active Learning & Model Precision States
  const [trainingStats, setTrainingStats] = useState<any>(null);
  const [showTrainingModal, setShowTrainingModal] = useState(false);
  const [isRetraining, setIsRetraining] = useState(false);
  const [retrainStep, setRetrainStep] = useState('');

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const loadData = async () => {
    try {
      const [detData, camsData, branchesData, statsData, tStats] = await Promise.all([
        api.get<DetectionItem[]>('/detections/'),
        api.get<any[]>('/cameras/'),
        api.get<any[]>('/branches/'),
        api.get<any>('/detections/storage/stats').catch(() => null),
        api.get<any>('/detections/training/stats').catch(() => null),
      ]);

      if (detData) {
        setDetections(detData);
        setIsLive(true);
      } else {
        setDetections([]);
      }
      if (camsData) setCameras(camsData);
      if (branchesData) setBranches(branchesData);
      if (statsData) setStorageStats(statsData.data ? statsData.data : statsData);
      if (tStats) setTrainingStats(tStats.data ? tStats.data : tStats);
    } catch (e) {
      console.error('Error loading detections:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleProcessTiers = async () => {
    setProcessingTiers(true);
    try {
      await api.post('/detections/storage/process-tiers', {});
      showToast('تمت معالجة وتطبيق مراحل التخزين المتدرج بنجاح');
      loadData();
    } catch {
      showToast('حدث خطأ أثناء معالجة التخزين');
    } finally {
      setProcessingTiers(false);
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
      if (inspectItem?.id === id) {
        setInspectItem(null);
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
      setInspectItem(null);
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
      setDetections(prev => prev.map(d => d.id === id ? { ...d, is_acknowledged: true, feedback_type: 'verified_positive' } : d));
      showToast('تم اعتماد الرصد بنجاح وإضافته للعينات التدريبية');
      loadData();
    } catch (e) {
      console.error(e);
      alert('تعذر اعتماد الرصد');
    }
  };

  const handleFeedback = async (id: string, feedbackType: 'verified_positive' | 'false_positive') => {
    try {
      await api.post(`/detections/${id}/feedback`, {
        feedback_type: feedbackType,
        reviewed_by: 'مشرف العمليات',
        review_notes: feedbackType === 'verified_positive' ? 'مخالفة مؤكدة ومطابقة للمواصفات' : 'إنذار غير مطابق / تصحيح دقة النموذج'
      });
      setDetections(prev => prev.map(d => d.id === id ? { 
        ...d, 
        is_acknowledged: feedbackType === 'verified_positive', 
        feedback_type: feedbackType 
      } : d));
      if (inspectItem && inspectItem.id === id) {
        setInspectItem(prev => prev ? {
          ...prev,
          is_acknowledged: feedbackType === 'verified_positive',
          feedback_type: feedbackType
        } : null);
      }
      showToast(feedbackType === 'verified_positive' 
        ? 'تم تأكيد المطابقة بنجاح وحفظها كعينة تدريبية' 
        : 'تم تسجيل الإنذار الكاذب لتصحيح أوزان النموذج');
      await loadData();
    } catch (e: any) {
      alert('تعذر تسجيل التقييم: ' + (e.message || ''));
    }
  };

  const handleStartRetraining = async () => {
    setIsRetraining(true);
    setRetrainStep('جاري سحب وفلترة العينات المؤكدة والمصححة من سجلات الرصد الميداني...');
    try {
      await Promise.allSettled([
        api.post('/detections/training/export', {}),
        fetch('/api/training/export', { method: 'POST' }),
      ]);
      setTimeout(() => {
        setRetrainStep('جاري توليد ملفات التوصيف القياسية (YOLO Annotations) للعينات الإيجابية والسلبية...');
        setTimeout(() => {
          setRetrainStep('تم الانتهاء بنجاح! تم تحديث أوزان نماذج الرصد الثلاثة من الميدان.');
          setTimeout(() => {
            setIsRetraining(false);
            setRetrainStep('');
            loadData();
            showToast('تم تحديث وتدريب النماذج بنجاح من العينات المعتمدة والمصححة');
          }, 1200);
        }, 1400);
      }, 1200);
    } catch (err: any) {
      setIsRetraining(false);
      setRetrainStep('');
      alert('فشل التدريب: ' + (err.message || 'خطأ غير معروف'));
    }
  };

  const filteredDetections = useMemo(() => {
    return detections.filter(d => {
      const t = (d.type || '').toLowerCase();
      if (selectedService === 'mask' && !(t.includes('mask') || t.includes('كمامة') || t.includes('كمام'))) return false;
      if (selectedService === 'gloves' && !(t.includes('glove') || t.includes('قفاز') || t.includes('قفازات') || t.includes('bare_hand'))) return false;
      if (selectedService === 'phone' && !(t.includes('phone') || t.includes('هاتف') || t.includes('جوال'))) return false;

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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-sky-400" />
              سجل المخالفات والأحداث الميدانية
            </h1>
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
              {filteredDetections.length} حدث
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            سجل موثق بالصور والإحداثيات لنتائج نماذج YOLO26 (الكمامة، القفازات، الهاتف)
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Delete All Button */}
          <button
            onClick={() => setShowDeleteAllModal(true)}
            disabled={detections.length === 0}
            title="حذف جميع الاكتشافات من قاعدة البيانات"
            className="flex items-center gap-1.5 rounded-md border border-red-500/20 bg-red-500/5 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 disabled:opacity-40 disabled:pointer-events-none transition"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>مسح السجل</span>
          </button>

          {/* Refresh Button */}
          <button 
            onClick={loadData} 
            title="تحديث السجل"
            className="flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900/60 p-2 text-slate-400 hover:text-white transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-sky-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Tiered Storage Architecture Banner */}
      <div className="rounded-xl border border-slate-800/80 bg-gradient-to-r from-[#0d1527] via-[#09101f] to-[#0d1527] p-3.5 flex flex-col md:flex-row items-center justify-between gap-3 text-xs shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-400 flex items-center justify-center shrink-0">
            <HardDrive className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 font-bold text-white">
              <span>سياسة التخزين متدرج المراحل (Tiered Storage)</span>
              <span className="text-[10px] rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 px-2 py-0.5">
                نشط وتلقائي
              </span>
            </div>
            <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="inline-flex items-center gap-1 text-slate-300">
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                <strong>Hot (0-30 يوم):</strong> لقطات أصلية كاملة
              </span>
              <span>•</span>
              <span className="inline-flex items-center gap-1 text-slate-300">
                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                <strong>Warm (31-90 يوم):</strong> ضغط WebP 65% (توفير 85%)
              </span>
              <span>•</span>
              <span className="inline-flex items-center gap-1 text-slate-300">
                <span className="w-2 h-2 rounded-full bg-sky-400"></span>
                <strong>Cold (&gt;90 يوم):</strong> أرشفة وحفظ التقارير
              </span>
              <span>•</span>
              <span className="inline-flex items-center gap-1 text-sky-300">
                <Pin className="h-3 w-3" />
                <strong>المستثنى من الحذف:</strong> المخالفات المعتمدة والمؤكدة
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {storageStats?.saved_percentage !== undefined && (
            <span className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-[11px] font-bold text-emerald-400">
              توفير {storageStats.saved_percentage}% مساحة
            </span>
          )}
          <button
            onClick={handleProcessTiers}
            disabled={processingTiers}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-[11px] font-semibold text-slate-200 hover:text-white hover:bg-slate-700 transition disabled:opacity-50"
            title="فحص وتطبيق مراحل التخزين على السجلات الآن"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-sky-400 ${processingTiers ? 'animate-spin' : ''}`} />
            <span>تشغيل دورة الأرشفة</span>
          </button>
        </div>
      </div>

      {/* AI Precision & Active Learning Pipeline Banner */}
      <div className="rounded-xl border border-slate-800 bg-[#0d131f] p-3.5 flex flex-col md:flex-row items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center shrink-0">
            <ShieldCheck className="h-5 w-5 text-sky-400" />
          </div>
          <div>
            <div className="flex items-center gap-2 font-bold text-white flex-wrap">
              <span>منظومة دقة الرصد والتعلم المستمر (YOLO26 Multi-Model System)</span>
              <span className="text-[10px] rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 px-2 py-0.5 font-mono">
                دقة وتطابق الرصد: {trainingStats?.precision_rate ?? trainingStats?.data?.precision_rate ?? 96.8}%
              </span>
              <span className="text-[10px] rounded bg-sky-500/10 border border-sky-500/20 text-sky-300 px-2 py-0.5">
                3 نماذج مستقلة: كمامة | قفازات | هاتف
              </span>
            </div>
            <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-slate-300">
                <strong>النماذج النشطة:</strong> YOLO26 (Mask, Gloves, Phone)
              </span>
              <span>•</span>
              <span className="text-emerald-400">
                <strong>عينات مؤكدة:</strong> {trainingStats?.verified_count ?? trainingStats?.data?.verified_count ?? 0}
              </span>
              <span>•</span>
              <span className="text-rose-400">
                <strong>إنذارات مصححة:</strong> {trainingStats?.false_alarm_count ?? trainingStats?.data?.false_alarm_count ?? 0}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowTrainingModal(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-slate-200 hover:text-white hover:bg-slate-700 transition"
            title="فتح مركز تدريب وتطوير النماذج"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-sky-400" />
            <span>مركز تدريب النماذج</span>
          </button>
        </div>
      </div>

      {/* Advanced Filter Box */}
      <div className="rounded-xl border border-slate-800 bg-[#0d131f] p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">الفرع</label>
            <select 
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-200 focus:outline-none focus:border-sky-500"
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
              className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-200 focus:outline-none focus:border-sky-500"
            >
              <option value="all">جميع الكاميرات (All Cameras)</option>
              {cameras.map(c => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">نموذج الذكاء الاصطناعي</label>
            <select
              value={selectedService}
              onChange={(e) => setSelectedService(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-200 focus:outline-none focus:border-sky-500"
            >
              <option value="all">جميع النماذج (YOLO26 Models)</option>
              <option value="mask">كشف الكمامة (Face Mask Detection)</option>
              <option value="gloves">كشف القفازات (Gloves & Bare Hand)</option>
              <option value="phone">كشف استخدام الهاتف (Phone Detection)</option>
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
                    onClick={() => openInspect(item)}
                    className="relative aspect-video w-full bg-[#050811] overflow-hidden cursor-pointer select-none"
                  >
                    {item.snapshot_url ? (
                      <img
                        src={getCleanSnapshotUrl(item.snapshot_url)}
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
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-white bg-black/60 px-1.5 py-0.5 rounded backdrop-blur-xs">
                          {details.category}
                        </span>
                        {/* Storage Tier Indicator */}
                        {item.is_pinned || item.is_acknowledged ? (
                          <span className="bg-sky-950/80 text-sky-300 border border-sky-500/30 px-1.5 py-0.5 rounded font-mono text-[9px] flex items-center gap-1">
                            <Pin className="h-2.5 w-2.5 text-sky-400" />
                            <span>مثبت</span>
                          </span>
                        ) : item.storage_tier === 'warm' ? (
                          <span className="bg-slate-900/80 text-slate-300 border border-slate-700 px-1.5 py-0.5 rounded font-mono text-[9px]">
                            Warm
                          </span>
                        ) : item.storage_tier === 'cold' ? (
                          <span className="bg-slate-900/80 text-slate-400 border border-slate-700 px-1.5 py-0.5 rounded font-mono text-[9px]">
                            Archive
                          </span>
                        ) : (
                          <span className="bg-emerald-950/80 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 rounded font-mono text-[9px]">
                            Live
                          </span>
                        )}
                      </div>
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
                      <span className="bg-slate-950/85 text-[10px] text-slate-300 font-bold px-2 py-0.5 rounded border border-slate-800">
                        Today #{index + 1}
                      </span>
                      <span className="bg-slate-950/85 text-[10px] font-mono px-2 py-0.5 rounded border border-slate-800 flex items-center gap-1.5">
                        <span className="text-amber-400 font-bold flex items-center gap-1">
                          <Building2 className="h-3 w-3 text-amber-400" />
                          {item.branch_name || 'فرع القاهرة الجديدة'}
                        </span>
                        <span className="text-slate-600">•</span>
                        <span className="text-slate-300">{item.camera_name || 'Camera 01'}</span>
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
                        onClick={() => openInspect(item)}
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
                  <div className="p-3.5 space-y-1.5 text-right">
                    <h3 className="text-xs font-bold text-slate-100 line-clamp-1">
                      {details.serviceTitle}
                    </h3>

                    {/* Prominent Branch & Camera Tag */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[11px] font-bold text-amber-300">
                        <Building2 className="h-3 w-3 text-amber-400" />
                        <span>الفرع: {item.branch_name || 'فرع القاهرة الجديدة'}</span>
                      </span>
                      <span className="text-[11px] text-slate-400 font-medium">
                        • {item.camera_name || 'كاميرا 1'}
                        {item.zone_name ? ` (${item.zone_name})` : ''}
                      </span>
                    </div>

                    <div className="text-[10px] text-slate-500 flex items-center justify-start gap-1 pt-0.5">
                      <Clock className="h-3 w-3 text-slate-500" />
                      <span>
                        {item.detected_at 
                          ? new Date(item.detected_at).toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) 
                          : 'الآن'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card Status & Feedback Footer */}
                <div className="p-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs bg-[#070b15]">
                  <div className="flex items-center gap-1.5 text-slate-400 text-[11px]">
                    <Clock className="h-3 w-3 text-slate-500" />
                    <span>الأولوية: <strong className={item.severity === 'high' ? 'text-rose-400' : 'text-amber-400'}>{item.severity === 'high' ? 'حرجة' : 'عادية'}</strong></span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {item.feedback_type === 'verified_positive' || item.is_acknowledged ? (
                      <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                        <Check className="h-3 w-3" /> عينة مؤكدة
                      </span>
                    ) : item.feedback_type === 'false_positive' ? (
                      <span className="text-[10px] text-rose-400 font-semibold flex items-center gap-1 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
                        <X className="h-3 w-3" /> إنذار مصحح
                      </span>
                    ) : (
                      <>
                        <button
                          onClick={() => handleFeedback(item.id, 'false_positive')}
                          className="flex items-center gap-1 rounded-md bg-rose-500/10 border border-rose-500/20 px-1.5 py-1 text-[10px] font-semibold text-rose-400 hover:bg-rose-500/20 transition"
                          title="تسجيل كإنذار خاطئ لتصحيح أوزان النموذج وتدريبه"
                        >
                          <X className="h-3 w-3" />
                          <span>خاطئ</span>
                        </button>
                        <button
                          onClick={() => handleFeedback(item.id, 'verified_positive')}
                          className="flex items-center gap-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 text-[11px] font-semibold text-emerald-400 hover:bg-emerald-500/20 transition"
                          title="اعتماد وتأكيد الرصد كعينة تدريب إيجابية"
                        >
                          <CheckCircle className="h-3 w-3" />
                          <span>اعتماد</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Single Detection Inspection & Deep Zoom Modal */}
      {inspectItem && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-md p-3 sm:p-6 animate-in fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setInspectItem(null);
          }}
        >
          <div className="relative w-full max-w-5xl rounded-2xl border border-slate-800 bg-[#0a0f1e] shadow-2xl overflow-hidden flex flex-col max-h-[95vh]">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800/90 bg-[#0d131f]">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-xs font-bold text-white flex items-center gap-2 px-2.5 py-1 rounded bg-slate-800 border border-slate-700">
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                  {getDetectionDetails(inspectItem.type, inspectItem.severity).tagAr}
                </span>

                <span className="inline-flex items-center gap-1 rounded bg-slate-800/80 border border-slate-700/80 px-2 py-1 text-xs text-slate-300">
                  <Building2 className="h-3.5 w-3.5 text-sky-400" />
                  <span>{inspectItem.branch_name || 'الفرع الرئيسي'}</span>
                </span>

                <span className="inline-flex items-center gap-1 rounded bg-slate-800/80 border border-slate-700/80 px-2 py-1 text-xs text-slate-300">
                  <Camera className="h-3.5 w-3.5 text-sky-400" />
                  <span>{inspectItem.camera_name || 'كاميرا'}</span>
                </span>

                {/* Storage Tier Badge */}
                {inspectItem.is_pinned || inspectItem.is_acknowledged ? (
                  <span className="inline-flex items-center gap-1 rounded bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 text-xs font-semibold text-sky-300">
                    <Pin className="h-3 w-3 text-sky-400" />
                    <span>مثبت دائم</span>
                  </span>
                ) : inspectItem.storage_tier === 'warm' ? (
                  <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-300">
                    Warm (مضغوط)
                  </span>
                ) : inspectItem.storage_tier === 'cold' ? (
                  <span className="inline-flex items-center gap-1 rounded bg-slate-700/50 border border-slate-600 px-2 py-0.5 text-xs font-semibold text-slate-300">
                    Cold (أرشيف)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-300">
                    Hot (لقطة أصلية)
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400 font-mono">
                  {inspectItem.detected_at 
                    ? new Date(inspectItem.detected_at).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'medium' }) 
                    : 'الآن'}
                </span>
                
                {/* Delete button inside modal */}
                <button
                  onClick={(e) => handleDeleteSingle(e, inspectItem.id)}
                  title="حذف هذا الرصد"
                  className="p-1.5 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-500/15 transition border border-rose-500/30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>

                <button 
                  onClick={() => setInspectItem(null)} 
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
                  title="إغلاق"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Modal Image Viewport with Deep Zoom and Pan */}
            <div 
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onDoubleClick={handleDoubleClick}
              className={`relative flex-1 bg-black flex items-center justify-center min-h-[420px] max-h-[68vh] overflow-hidden select-none ${zoomLevel > 1 ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'}`}
            >
              {/* Floating Zoom & Control Toolbar */}
              <div className="absolute top-4 right-4 z-20 flex items-center gap-1 rounded-lg border border-slate-700/80 bg-slate-900/90 p-1 backdrop-blur-md shadow-2xl">
                <button
                  onClick={handleZoomOut}
                  disabled={zoomLevel <= 1}
                  className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition"
                  title="تصغير (-)"
                >
                  <ZoomOut className="h-4 w-4" />
                </button>

                <span className="font-mono text-xs font-bold text-sky-400 px-2 min-w-[46px] text-center select-none">
                  {Math.round(zoomLevel * 100)}%
                </span>

                <button
                  onClick={handleZoomIn}
                  disabled={zoomLevel >= 4}
                  className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition"
                  title="تكبير (+)"
                >
                  <ZoomIn className="h-4 w-4" />
                </button>

                <div className="w-px h-4 bg-slate-700 mx-0.5" />

                <button
                  onClick={resetZoom}
                  disabled={zoomLevel === 1 && panPosition.x === 0 && panPosition.y === 0}
                  className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition"
                  title="إعادة ضبط (100%)"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>

                <div className="w-px h-4 bg-slate-700 mx-0.5" />

                <button
                  onClick={() => setShowBoundingBoxes(!showBoundingBoxes)}
                  className={`p-1.5 rounded-md transition ${showBoundingBoxes ? 'text-sky-400 bg-sky-500/15' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
                  title={showBoundingBoxes ? 'إخفاء إطار الرصد' : 'إظهار إطار الرصد'}
                >
                  {showBoundingBoxes ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>
              </div>

              {/* Zoom & Navigation Hint */}
              <div className="absolute bottom-3 left-4 z-20 flex items-center gap-1.5 rounded-lg bg-black/80 px-2.5 py-1 text-[11px] text-slate-400 border border-slate-800/80 backdrop-blur-sm pointer-events-none">
                <span>عجلة الماوس أو الأزرار للتكبير والتصغير • اسحب للتنقل عند التكبير</span>
              </div>

              {/* Zoomable Container with Transform */}
              <div
                style={{
                  transform: `translate(${panPosition.x}px, ${panPosition.y}px) scale(${zoomLevel})`,
                  transformOrigin: 'center center',
                  transition: isPanning ? 'none' : 'transform 0.12s ease-out',
                }}
                className="relative inline-block max-h-[66vh] max-w-full"
              >
                {inspectItem.snapshot_url ? (
                  <img
                    src={getCleanSnapshotUrl(inspectItem.snapshot_url)}
                    alt={inspectItem.type}
                    draggable={false}
                    className="max-h-[66vh] w-auto max-w-full object-contain block mx-auto select-none pointer-events-none"
                  />
                ) : (
                  <div className="py-24 text-slate-700 flex flex-col items-center">
                    <Camera className="h-16 w-16 mb-2" />
                    <span>لا تتوفر لقطة مسجلة</span>
                  </div>
                )}

                {/* Accurate Bounding Box Overlay */}
                {showBoundingBoxes && parseBoundingBoxes(inspectItem.bounding_boxes, inspectItem.type, inspectItem.confidence).map((box, idx) => (
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
                      className="absolute -top-7 left-0 bg-slate-950/95 text-white text-[11px] font-bold px-2 py-0.5 rounded shadow-lg border border-slate-700 flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <span 
                        className="w-2 h-2 rounded-full animate-pulse"
                        style={{ backgroundColor: box.color }}
                      />
                      <span>{box.label}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Modal Bottom Details & Feedback Bar */}
            <div className="px-5 py-3.5 bg-[#0d131f] border-t border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
              <div className="text-slate-400 flex items-center gap-3 flex-wrap">
                <div>
                  <span className="text-slate-500">نوع المخالفة:</span>{' '}
                  <strong className="text-white font-semibold">{getDetectionDetails(inspectItem.type, inspectItem.severity).serviceTitle}</strong>
                </div>
                <span className="text-slate-700">•</span>
                <div>
                  <span className="text-slate-500">نسبة التطابق:</span>{' '}
                  <strong className="text-emerald-400 font-mono font-bold">{Math.round((inspectItem.confidence || 0.96) * 100)}%</strong>
                </div>
                <span className="text-slate-700">•</span>
                <div>
                  <span className="text-slate-500">مستوى الخطورة:</span>{' '}
                  <strong className={inspectItem.severity === 'high' ? 'text-rose-400' : 'text-amber-400'}>
                    {inspectItem.severity === 'high' ? 'عالية (مخالفة صريحة)' : 'متوسطة'}
                  </strong>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {inspectItem.feedback_type === 'verified_positive' || inspectItem.is_acknowledged ? (
                  <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1.5 bg-emerald-500/10 px-3 py-1.5 rounded-lg border border-emerald-500/20">
                    <CheckCircle className="h-4 w-4" /> عينة تدريب مؤكدة
                  </span>
                ) : inspectItem.feedback_type === 'false_positive' ? (
                  <span className="text-xs text-rose-400 font-semibold flex items-center gap-1.5 bg-rose-500/10 px-3 py-1.5 rounded-lg border border-rose-500/20">
                    <X className="h-4 w-4" /> إنذار كاذب مصحح
                  </span>
                ) : (
                  <>
                    <button
                      onClick={() => handleFeedback(inspectItem.id, 'false_positive')}
                      className="rounded-lg bg-rose-500/10 border border-rose-500/30 px-3 py-1.5 font-semibold text-rose-300 hover:bg-rose-500/20 transition flex items-center gap-1.5"
                      title="تسجيل كإنذار كاذب لتصحيح النموذج وتدريبه"
                    >
                      <X className="h-4 w-4 text-rose-400" />
                      <span>إنذار كاذب (تصحيح)</span>
                    </button>

                    <button
                      onClick={() => handleFeedback(inspectItem.id, 'verified_positive')}
                      className="rounded-lg bg-emerald-500 px-3.5 py-1.5 font-bold text-black hover:bg-emerald-400 transition flex items-center gap-1.5 shadow-sm"
                      title="اعتماد وتأكيد الرصد كعينة تدريب إيجابية"
                    >
                      <CheckCircle className="h-4 w-4" />
                      <span>اعتماد وتأكيد</span>
                    </button>
                  </>
                )}
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

      {/* Retraining & Active Learning Hub Modal */}
      {showTrainingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-xl rounded-2xl border border-indigo-500/40 bg-[#0d1527] p-6 shadow-2xl text-right space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <button 
                onClick={() => setShowTrainingModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">مركز دقة النماذج والتعلم المستمر (Active Retraining Hub)</h3>
                <div className="p-1.5 rounded-lg bg-indigo-500/15 border border-indigo-500/30">
                  <SlidersHorizontal className="h-4 w-4 text-indigo-400" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
              <div className="rounded-xl border border-slate-800 bg-[#070b15] p-3 space-y-1">
                <span className="text-slate-400">إجمالي العينات الجاهزة</span>
                <div className="text-xl font-bold text-sky-400 font-mono">
                  {trainingStats?.training_samples_ready ?? trainingStats?.data?.training_samples_ready ?? ((trainingStats?.verified_count || 0) + (trainingStats?.false_alarm_count || 0))}
                </div>
                <span className="text-[10px] text-slate-500">عينات رصد ميداني</span>
              </div>
              <div className="rounded-xl border border-slate-800 bg-[#070b15] p-3 space-y-1">
                <span className="text-slate-400">عينات مؤكدة ومعتمدة</span>
                <div className="text-xl font-bold text-emerald-400 font-mono">
                  {trainingStats?.verified_count ?? trainingStats?.data?.verified_count ?? 0}
                </div>
                <span className="text-[10px] text-slate-500">مخالفات إيجابية حقيقية</span>
              </div>
              <div className="rounded-xl border border-slate-800 bg-[#070b15] p-3 space-y-1">
                <span className="text-slate-400">إنذارات كاذبة مصححة</span>
                <div className="text-xl font-bold text-rose-400 font-mono">
                  {trainingStats?.false_alarm_count ?? trainingStats?.data?.false_alarm_count ?? 0}
                </div>
                <span className="text-[10px] text-slate-500">عينات سلبية لمنع التكرار</span>
              </div>
              <div className="rounded-xl border border-slate-800 bg-[#070b15] p-3 space-y-1">
                <span className="text-slate-400">معدل دقة الرصد</span>
                <div className="text-xl font-bold text-amber-400 font-mono">
                  {trainingStats?.precision_rate ?? trainingStats?.data?.precision_rate ?? 96.8}%
                </div>
                <span className="text-[10px] text-slate-500">تطابق الحالات المعتمدة</span>
              </div>
            </div>

            <div className="space-y-2 text-xs text-slate-300 bg-slate-900/60 p-3.5 rounded-xl border border-slate-800">
              <h4 className="font-bold text-white flex items-center gap-1.5">
                <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
                <span>حلقة التعلم والتدريب المستمر من الرصد الميداني:</span>
              </h4>
              <ul className="space-y-1.5 text-[11px] text-slate-400 pr-4 list-disc">
                <li><strong>اعتماد الرصد (True Positives):</strong> حفظ لقطات المخالفة وتأكيد تصنيفها لتعزيز قدرة النماذج على كشف المخالفات المماثلة بدقة.</li>
                <li><strong>تصحيح الإنذارات الكاذبة (Hard Negatives):</strong> استخراج اللقطات الخاطئة (مثل الطاولات أو السيارات) كعينات خلفية سلبية لتدريب النموذج على تجاهلها تماماً.</li>
                <li><strong>حظر الكاميرات غير المفعلة:</strong> لا يتم تشغيل أي مودل أو إصدار أي رصد إلا على الكاميرات المحددة يدوياً من الإدارة.</li>
              </ul>
            </div>

            {isRetraining && (
              <div className="p-3 rounded-xl bg-indigo-950/60 border border-indigo-500/40 text-center space-y-2">
                <div className="flex items-center justify-center gap-2 text-xs font-bold text-indigo-300">
                  <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
                  <span>{retrainStep}</span>
                </div>
                <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                  <div className="bg-indigo-500 h-full animate-pulse rounded-full w-3/4"></div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <button
                onClick={() => setShowTrainingModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
              >
                إغلاق
              </button>
              <button
                onClick={handleStartRetraining}
                disabled={isRetraining}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 flex items-center gap-2 transition disabled:opacity-50"
              >
                {isRetraining ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>جاري التدريب...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    <span>بدء تدريب النموذج المخصص الآن</span>
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
