'use client';

import React, { useState, useEffect } from 'react';
import { 
  CheckSquare, Plus, Clock, User, Building2, AlertCircle, 
  CheckCircle2, Filter, Search, Trash2, Loader2, RefreshCw 
} from 'lucide-react';
import { api } from '@/lib/api';

interface Task {
  id: string;
  branch_id: string;
  branch_name: string;
  detection_id?: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  assigned_to: string;
  created_at: string;
}

interface BranchItem {
  id: string;
  name: string;
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [newTaskBranch, setNewTaskBranch] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState('medium');
  const [newTaskAssignee, setNewTaskAssignee] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const [tasksData, branchesData] = await Promise.all([
        api.get<Task[]>('/tasks/'),
        api.get<BranchItem[]>('/branches/'),
      ]);

      if (tasksData) setTasks(tasksData);
      if (branchesData && branchesData.length > 0) {
        setBranches(branchesData);
        setNewTaskBranch((prev) => prev || branchesData[0].id);
      }
    } catch (err) {
      console.error(err);
      setError('تعذر تحميل قائمة المهام');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle) return;
    setSubmitting(true);
    setError('');

    try {
      const branchId = newTaskBranch || (branches[0]?.id || '');
      await api.post('/tasks/', {
        branch_id: branchId,
        title: newTaskTitle,
        description: newTaskDesc,
        priority: newTaskPriority,
        assigned_to: newTaskAssignee || 'مدير الفرع',
      });

      setShowAddModal(false);
      setNewTaskTitle('');
      setNewTaskDesc('');
      setNewTaskAssignee('');
      await loadData();
    } catch (err: any) {
      setError(err.message || 'تعذر إنشاء المهمة');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateStatus = async (id: string, newStatus: string) => {
    try {
      await api.patch(`/tasks/${id}/status`, { status: newStatus });
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, status: newStatus } : t))
      );
    } catch (err) {
      console.error(err);
      alert('تعذر تحديث حالة المهمة');
    }
  };

  const handleDeleteTask = async (id: string, title: string) => {
    if (!confirm(`هل أنت متأكد من حذف المهمة "${title}"؟`)) return;

    try {
      await api.delete(`/tasks/${id}`);
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch (err: any) {
      alert(err.message || 'تعذر حذف المهمة');
    }
  };

  const filteredTasks = tasks.filter((t) => {
    if (filterStatus === 'all') return true;
    return t.status === filterStatus;
  });

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <CheckSquare className="h-6 w-6 text-amber-500" />
            <span>إدارة المهام والإسناد التلقائي</span>
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            متابعة معالجة المخالفات الميدانية وإسنادها للمسؤولين في الفروع
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadData}
            title="تحديث المهام"
            className="p-2 rounded-lg bg-slate-800 text-slate-400 hover:text-white transition"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400 transition shadow-lg shadow-amber-500/20"
          >
            <Plus className="h-4 w-4" />
            <span>مهمة جديدة</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Stats Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-800 bg-[#0d1527] p-4">
          <div className="text-xs text-slate-400">إجمالي المهام المسجلة</div>
          <div className="text-2xl font-bold text-white mt-1">{tasks.length}</div>
        </div>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="text-xs text-amber-400">قيد المعالجة / انتظار</div>
          <div className="text-2xl font-bold text-amber-400 mt-1">
            {tasks.filter((t) => t.status !== 'completed').length}
          </div>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <div className="text-xs text-emerald-400">المهام المنجزة</div>
          <div className="text-2xl font-bold text-emerald-400 mt-1">
            {tasks.filter((t) => t.status === 'completed').length}
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
        <button
          onClick={() => setFilterStatus('all')}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            filterStatus === 'all'
              ? 'bg-amber-500 text-black font-bold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          الكل ({tasks.length})
        </button>
        <button
          onClick={() => setFilterStatus('pending')}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            filterStatus === 'pending'
              ? 'bg-amber-500 text-black font-bold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          قيد الانتظار ({tasks.filter((t) => t.status === 'pending').length})
        </button>
        <button
          onClick={() => setFilterStatus('in_progress')}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            filterStatus === 'in_progress'
              ? 'bg-amber-500 text-black font-bold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          قيد التنفيذ ({tasks.filter((t) => t.status === 'in_progress').length})
        </button>
        <button
          onClick={() => setFilterStatus('completed')}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            filterStatus === 'completed'
              ? 'bg-amber-500 text-black font-bold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          المكتملة ({tasks.filter((t) => t.status === 'completed').length})
        </button>
      </div>

      {/* Tasks Table / Card List */}
      <div className="space-y-3">
        {loading ? (
          <div className="py-12 text-center text-sm text-slate-500">
            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-amber-500" />
            جاري تحميل المهام من قاعدة البيانات...
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500 rounded-xl border border-slate-800 bg-[#0d1527]">
            لا توجد مهام تطابق الفلتر المختار
          </div>
        ) : (
          filteredTasks.map((t) => (
            <div
              key={t.id}
              className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl border border-slate-800/80 bg-[#0d1527] p-4 transition hover:border-slate-700"
            >
              <div className="flex items-start gap-3">
                <button
                  onClick={() =>
                    handleUpdateStatus(t.id, t.status === 'completed' ? 'pending' : 'completed')
                  }
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition ${
                    t.status === 'completed'
                      ? 'border-emerald-500 bg-emerald-500 text-black'
                      : 'border-slate-700 bg-slate-800 text-transparent hover:border-slate-600'
                  }`}
                >
                  <CheckCircle2 className="h-4 w-4" />
                </button>
                <div>
                  <h3
                    className={`text-sm font-semibold ${
                      t.status === 'completed' ? 'text-slate-500 line-through' : 'text-slate-100'
                    }`}
                  >
                    {t.title}
                  </h3>
                  {t.description && (
                    <p className="mt-1 text-xs text-slate-400 line-clamp-1">{t.description}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <Building2 className="h-3.5 w-3.5" />
                      {t.branch_name || 'فرع القاهرة الجديدة'}
                    </span>
                    <span className="flex items-center gap-1">
                      <User className="h-3.5 w-3.5" />
                      {t.assigned_to || 'غير مسند'}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {new Date(t.created_at).toLocaleDateString('ar-EG')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Badges & Actions */}
              <div className="flex items-center gap-3 self-end sm:self-center">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                    t.priority === 'urgent' || t.priority === 'high'
                      ? 'border border-red-500/20 bg-red-500/10 text-red-400'
                      : 'border border-amber-500/20 bg-amber-500/10 text-amber-400'
                  }`}
                >
                  {t.priority === 'urgent' ? 'عاجل جداً' : t.priority === 'high' ? 'أولوية قصوى' : 'متوسط'}
                </span>

                <select
                  value={t.status}
                  onChange={(e) => handleUpdateStatus(t.id, e.target.value)}
                  className="rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-xs text-slate-300 focus:border-amber-500 focus:outline-none"
                >
                  <option value="pending">قيد الانتظار</option>
                  <option value="in_progress">قيد التنفيذ</option>
                  <option value="completed">تم الإنجاز</option>
                </select>

                <button
                  onClick={() => handleDeleteTask(t.id, t.title)}
                  title="حذف المهمة"
                  className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-red-400 transition"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add Task Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-[#0d1527] p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-white mb-4">إنشاء مهمة ميدانية جديدة</h2>
            <form onSubmit={handleCreateTask} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">عنوان المهمة</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: فحص التزام قفازات العمل في المطبخ"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">الفرع</label>
                <select
                  value={newTaskBranch}
                  onChange={(e) => setNewTaskBranch(e.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">الوصف والتفاصيل</label>
                <textarea
                  rows={3}
                  placeholder="أدخل الإجراء المطلوب وتوقيت المراجعة..."
                  value={newTaskDesc}
                  onChange={(e) => setNewTaskDesc(e.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">الأولوية</label>
                  <select
                    value={newTaskPriority}
                    onChange={(e) => setNewTaskPriority(e.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
                  >
                    <option value="low">منخفضة</option>
                    <option value="medium">متوسطة</option>
                    <option value="high">مرتفعة</option>
                    <option value="urgent">عاجل</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">إسناد إلى</label>
                  <input
                    type="text"
                    placeholder="اسم المسؤول أو الشيف"
                    value={newTaskAssignee}
                    onChange={(e) => setNewTaskAssignee(e.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                  />
                </div>
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
                  <span>حفظ المهمة</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
