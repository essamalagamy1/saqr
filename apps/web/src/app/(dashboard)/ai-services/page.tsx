'use client';

import React, { useState, useEffect } from 'react';
import {
  BrainCircuit,
  Clock,
  Smartphone,
  ShieldCheck,
  Users,
  Timer,
  CheckCircle2,
  Sliders,
  Search,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Loader2,
  RefreshCw
} from 'lucide-react';
import { api } from '@/lib/api';

interface AIServiceItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  is_active: boolean;
}

export default function AIServicesPage() {
  const [services, setServices] = useState<AIServiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadServices = async () => {
    setLoading(true);
    try {
      const data = await api.get<AIServiceItem[]>('/ai-services/');
      if (data) setServices(data);
    } catch (err) {
      console.error('Failed to load AI services:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadServices();
  }, []);

  const toggleService = async (service: AIServiceItem) => {
    const newStatus = !service.is_active;
    setTogglingId(service.id);
    try {
      await api.patch(`/ai-services/${service.id}/status`, { is_active: newStatus });
      setServices((prev) =>
        prev.map((s) => (s.id === service.id ? { ...s, is_active: newStatus } : s))
      );
    } catch (err: any) {
      alert('تعذر تحديث حالة الخدمة');
    } finally {
      setTogglingId(null);
    }
  };

  const getServiceIcon = (slug: string) => {
    switch (slug) {
      case 'loitering_detection':
        return Timer;
      case 'phone_usage':
        return Smartphone;
      case 'kitchen_ppe':
        return ShieldCheck;
      case 'queue_wait_time':
        return Clock;
      case 'visitor_counting':
      case 'employee_monitoring':
      default:
        return Users;
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'safety':
        return 'text-rose-400 bg-rose-500/10 border-rose-500/20';
      case 'operations':
        return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
      case 'analytics':
        return 'text-purple-400 bg-purple-500/10 border-purple-500/20';
      case 'monitoring':
      default:
        return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
    }
  };

  const filteredServices = services.filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || s.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-amber-500" />
            مركز خدمات وخوارزميات الذكاء الاصطناعي (YOLOX Models)
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            تفعيل وإدارة نماذج الرؤية الحاسوبية على الكاميرات المسجلة في فروع المنشأة
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadServices}
            title="تحديث الخدمات"
            className="p-2 rounded-lg bg-slate-800 text-slate-400 hover:text-white transition"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-400">
            <Sparkles className="h-3.5 w-3.5" />
            <span>الخدمات النشطة: {services.filter((s) => s.is_active).length} من {services.length}</span>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-xl border border-slate-800/80 bg-[#0d1527] p-4">
        <div className="relative w-full sm:w-80">
          <Search className="absolute right-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="text"
            placeholder="بحث في خوارزميات وخدمات الـ AI..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-800 bg-slate-900 py-2 pr-9 pl-4 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {['all', 'safety', 'operations', 'analytics', 'monitoring'].map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`rounded-lg px-3 py-1.5 font-medium transition ${
                selectedCategory === cat
                  ? 'bg-amber-500 text-black font-bold'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {cat === 'all'
                ? 'الكل'
                : cat === 'safety'
                ? 'السلامة (PPE)'
                : cat === 'operations'
                ? 'العمليات'
                : cat === 'analytics'
                ? 'التحليلات'
                : 'المراقبة'}
            </button>
          ))}
        </div>
      </div>

      {/* Services Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {loading ? (
          <div className="col-span-full py-16 text-center text-slate-500">
            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-amber-500" />
            جاري تحميل خدمات الذكاء الاصطناعي من قاعدة البيانات...
          </div>
        ) : filteredServices.length === 0 ? (
          <div className="col-span-full py-16 text-center text-slate-500">
            لا توجد خدمات مطابقة لبحثك
          </div>
        ) : (
          filteredServices.map((service) => {
            const Icon = getServiceIcon(service.slug);
            const badgeClass = getCategoryColor(service.category);
            const isToggling = togglingId === service.id;

            return (
              <div
                key={service.id}
                className={`relative flex flex-col justify-between rounded-xl border p-5 shadow-lg transition-all ${
                  service.is_active
                    ? 'border-slate-800/80 bg-[#0d1527] hover:border-slate-700'
                    : 'border-slate-800/40 bg-[#0d1527]/50 opacity-70'
                }`}
              >
                <div>
                  {/* Card Header: Icon + Category Badge + Toggle */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-xl border ${badgeClass}`}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${badgeClass}`}>
                          {service.category.toUpperCase()}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => toggleService(service)}
                      disabled={isToggling}
                      className="cursor-pointer transition hover:scale-105 disabled:opacity-50"
                      title={service.is_active ? 'تعطيل الخدمة' : 'تفعيل الخدمة'}
                    >
                      {isToggling ? (
                        <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
                      ) : service.is_active ? (
                        <ToggleRight className="h-7 w-7 text-amber-500" />
                      ) : (
                        <ToggleLeft className="h-7 w-7 text-slate-600" />
                      )}
                    </button>
                  </div>

                  {/* Title & Description */}
                  <h3 className="mt-4 text-base font-bold text-white">{service.name}</h3>
                  <p className="mt-1.5 text-xs text-slate-400 leading-relaxed line-clamp-3">
                    {service.description}
                  </p>
                </div>

                {/* Card Footer */}
                <div className="mt-6 border-t border-slate-800/80 pt-4 flex items-center justify-between text-xs text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    <span>مفعلة على كافة الكاميرات</span>
                  </span>
                  <span className="font-mono text-[10px] text-slate-500">YOLOX-S</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
