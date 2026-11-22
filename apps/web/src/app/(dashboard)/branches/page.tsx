'use client';

import React, { useState, useEffect } from 'react';
import { Building2, Plus, MapPin, Camera, Trash2, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';

interface BranchItem {
  id: string;
  name: string;
  city: string;
  address: string;
  is_active: boolean;
  cameras_count?: number;
}

export default function BranchesPage() {
  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [newBranch, setNewBranch] = useState({ name: '' });

  const loadBranches = async () => {
    setLoading(true);
    try {
      const data = await api.get<BranchItem[]>('/branches/');
      if (data) setBranches(data);
    } catch (e: any) {
      console.error(e);
      setError('تعذر تحميل الفروع من الخادم');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBranches();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBranch.name.trim()) return;
    setSubmitting(true);
    setError('');

    try {
      await api.post('/branches/', { name: newBranch.name.trim() });
      setShowAddModal(false);
      setNewBranch({ name: '' });
      await loadBranches();
    } catch (e: any) {
      setError(e.message || 'حدث خطأ أثناء إضافة الفرع');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`هل أنت متأكد من حذف فرع "${name}"؟ سيتم حذف جميع الكاميرات المرتبطة به.`)) return;

    try {
      await api.delete(`/branches/${id}`);
      setBranches((prev) => prev.filter((b) => b.id !== id));
    } catch (e: any) {
      alert(e.message || 'تعذر حذف الفرع');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Building2 className="h-5 w-5 text-amber-500" />
            إدارة الفروع ومواقع العمل
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            توزيع الكاميرات ومناطق المراقبة الذكية حسب الفروع الجغرافية
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadBranches}
            title="تحديث القائمة"
            className="p-2 rounded-lg bg-slate-800 text-slate-400 hover:text-white transition"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 transition shadow-lg shadow-amber-500/20"
          >
            <Plus className="h-4 w-4" />
            <span>إضافة فرع جديد</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Branches Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {loading ? (
          <div className="col-span-full py-12 text-center text-slate-500">
            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-amber-500" />
            جاري تحميل الفروع...
          </div>
        ) : branches.length === 0 ? (
          <div className="col-span-full py-12 text-center text-slate-500 rounded-xl border border-slate-800 bg-[#0d1527]">
            لا توجد فروع مسجلة. اضغط على "إضافة فرع جديد" لإضافة أول موقع.
          </div>
        ) : (
          branches.map((b) => (
            <div
              key={b.id}
              className="group rounded-xl border border-slate-800/80 bg-[#0d1527] p-5 shadow-lg transition-all hover:border-slate-700 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-bold text-white">{b.name}</h3>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
                      <MapPin className="h-3.5 w-3.5 text-amber-500" />
                      <span>{b.city ? `${b.city}${b.address ? ' — ' + b.address : ''}` : (b.address || 'الفرع الرئيسي')}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/20">
                      نشط
                    </span>
                    <button
                      onClick={() => handleDelete(b.id, b.name)}
                      title="حذف الفرع"
                      className="p-1 rounded bg-slate-800 text-slate-400 hover:text-red-400 transition"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-between border-t border-slate-800/80 pt-4 text-xs text-slate-400">
                <span className="flex items-center gap-1">
                  <Camera className="h-3.5 w-3.5 text-amber-500" />
                  <span>كاميرات الفرع نشطة</span>
                </span>
                <span className="text-[11px] font-mono text-slate-400">{b.id.substring(0, 8)}...</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0d1527] p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-white mb-4">إضافة فرع جديد</h2>
            <form onSubmit={handleAdd} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">اسم الفرع</label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="مثال: فرع الشيخ زايد أو الفرع الرئيسي"
                  value={newBranch.name}
                  onChange={(e) => setNewBranch({ name: e.target.value })}
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-400 hover:text-slate-200"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400 transition disabled:opacity-50"
                >
                  {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>حفظ الفرع</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
