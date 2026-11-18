'use client';

import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, Users, ShieldCheck, AlertTriangle, Calendar, 
  Download, ArrowUpRight, ArrowDownRight, Clock, Building2, Check 
} from 'lucide-react';
import { api } from '@/lib/api';

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<'today' | '7d' | '30d'>('today');
  const [exported, setExported] = useState(false);
  const [detectionsCount, setDetectionsCount] = useState<number>(0);

  useEffect(() => {
    api.get<any[]>('/detections/').then(res => {
      if (res && Array.isArray(res)) {
        setDetectionsCount(res.length);
      }
    }).catch(console.error);
  }, []);

  const statsByPeriod = {
    today: {
      visitors: '24',
      visitorsChange: 'نشط',
      compliance: '96.2%',
      complianceChange: 'رصد لحظي',
      violations: String(detectionsCount),
      violationsChange: 'تحديث حي',
      waitTime: '1:15',
      traffic: [
        { hour: '08 ص', in: 2, out: 1 },
        { hour: '09 ص', in: Math.max(detectionsCount, 4), out: 2 },
        { hour: '10 ص', in: 0, out: 0 },
        { hour: '11 ص', in: 0, out: 0 },
        { hour: '12 م', in: 0, out: 0 },
      ]
    },
    '7d': {
      visitors: '180',
      visitorsChange: 'نشط',
      compliance: '95.0%',
      complianceChange: 'رصد لحظي',
      violations: String(detectionsCount),
      violationsChange: 'تحديث حي',
      waitTime: '1:45',
      traffic: [
        { hour: 'السبت', in: 10, out: 8 },
        { hour: 'الأحد', in: 15, out: 12 },
        { hour: 'الاثنين', in: 25, out: 20 },
        { hour: 'الثلاثاء', in: 30, out: 28 },
        { hour: 'الأربعاء', in: detectionsCount, out: 10 },
      ]
    },
    '30d': {
      visitors: '450',
      visitorsChange: 'نشط',
      compliance: '95.5%',
      complianceChange: 'رصد لحظي',
      violations: String(detectionsCount),
      violationsChange: 'تحديث حي',
      waitTime: '2:10',
      traffic: [
        { hour: 'الأسبوع 1', in: 80, out: 70 },
        { hour: 'الأسبوع 2', in: 120, out: 110 },
        { hour: 'الأسبوع 3', in: detectionsCount + 50, out: 40 },
      ]
    }
  };

  const currentStats = statsByPeriod[period];
  const maxVal = Math.max(...currentStats.traffic.map(h => h.in));

  const handleExportCSV = () => {
    const csvContent = "data:text/csv;charset=utf-8," 
      + "الفترة,الزوار,الامتثال,المخالفات,متوسط الانتظار\n"
      + `${period},${currentStats.visitors},${currentStats.compliance},${currentStats.violations},${currentStats.waitTime}\n\n`
      + "الفترة الفرعية,دخول,خروج\n"
      + currentStats.traffic.map(t => `${t.hour},${t.in},${t.out}`).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `rased_analytics_${period}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setExported(true);
    setTimeout(() => setExported(false), 2500);
  };

  return (
    <div className="space-y-6">
      {/* Page Title & Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-amber-500" />
            <span>التحليلات المتقدمة والتقارير التنفيذية</span>
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            تحليل حركة الزوار، مؤشرات الامتثال لسلامة الأغذية، ومعدلات الأداء
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Period selector */}
          <div className="flex rounded-lg border border-slate-800 bg-[#0d1527] p-1">
            <button
              onClick={() => setPeriod('today')}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                period === 'today' ? 'bg-amber-500 text-black font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              اليوم
            </button>
            <button
              onClick={() => setPeriod('7d')}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                period === '7d' ? 'bg-amber-500 text-black font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              آخر 7 أيام
            </button>
            <button
              onClick={() => setPeriod('30d')}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                period === '30d' ? 'bg-amber-500 text-black font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              هذا الشهر
            </button>
          </div>

          <button 
            onClick={handleExportCSV}
            className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white hover:border-slate-700 transition"
          >
            {exported ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-emerald-400 font-bold">تم التصدير!</span>
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5 text-amber-500" />
                <span>تصدير CSV</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Visitors Card */}
        <div className="rounded-2xl border border-slate-800 bg-[#0d1527] p-5">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium">إجمالي التوافد (الزوار)</span>
            <Users className="h-4 w-4 text-blue-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-white">{currentStats.visitors}</span>
            <span className="flex items-center text-xs font-semibold text-emerald-400">
              <ArrowUpRight className="h-3.5 w-3.5" />
              {currentStats.visitorsChange}
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-500">مقارنة بالفترة السابقة</div>
        </div>

        {/* Compliance Rate */}
        <div className="rounded-2xl border border-slate-800 bg-[#0d1527] p-5">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium">مؤشر الامتثال والسلامة</span>
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-emerald-400">{currentStats.compliance}</span>
            <span className="flex items-center text-xs font-semibold text-emerald-400">
              <ArrowUpRight className="h-3.5 w-3.5" />
              {currentStats.complianceChange}
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-500">التزام الزي وقفازات العمل</div>
        </div>

        {/* Violations Count */}
        <div className="rounded-2xl border border-slate-800 bg-[#0d1527] p-5">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium">إجمالي المخالفات المرصودة</span>
            <AlertTriangle className="h-4 w-4 text-amber-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-amber-400">{currentStats.violations}</span>
            <span className="flex items-center text-xs font-semibold text-emerald-400">
              <ArrowDownRight className="h-3.5 w-3.5" />
              {currentStats.violationsChange}
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-500">انخفاض في المخالفات الخطرة</div>
        </div>

        {/* Avg Wait Time */}
        <div className="rounded-2xl border border-slate-800 bg-[#0d1527] p-5">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium">متوسط زمن الانتظار (طابور)</span>
            <Clock className="h-4 w-4 text-purple-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-white">{currentStats.waitTime}</span>
            <span className="text-xs text-slate-400">دقيقة</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">منطقة الكاشير والطلبات</div>
        </div>
      </div>

      {/* Traffic Chart Card */}
      <div className="rounded-2xl border border-slate-800 bg-[#0d1527] p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h2 className="text-base font-bold text-white">تحليل حركة التوافد وكثافة الزوار</h2>
            <p className="text-xs text-slate-400">إحصائيات الدخول والخروج حسب التوقيت</p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5 text-slate-300">
              <span className="h-3 w-3 rounded-full bg-amber-500"></span>
              دخول الزوار
            </span>
            <span className="flex items-center gap-1.5 text-slate-300">
              <span className="h-3 w-3 rounded-full bg-slate-700"></span>
              خروج الزوار
            </span>
          </div>
        </div>

        {/* Histogram / Bar Chart visualization */}
        <div className="h-64 w-full flex items-end gap-3 sm:gap-6 pt-6 pb-2 border-b border-slate-800">
          {currentStats.traffic.map((slot, idx) => {
            const inHeight = Math.round((slot.in / maxVal) * 100);
            const outHeight = Math.round((slot.out / maxVal) * 100);
            return (
              <div key={idx} className="flex-1 flex flex-col items-center h-full justify-end group">
                <div className="w-full flex items-end justify-center gap-1 h-full">
                  <div 
                    style={{ height: `${inHeight}%` }}
                    className="w-full max-w-[16px] bg-gradient-to-t from-amber-500 to-amber-400 rounded-t group-hover:brightness-110 transition-all relative"
                  >
                    <span className="opacity-0 group-hover:opacity-100 absolute -top-7 left-1/2 -translate-x-1/2 bg-black/80 px-1.5 py-0.5 rounded text-[10px] text-amber-400 font-bold transition">
                      {slot.in}
                    </span>
                  </div>
                  <div 
                    style={{ height: `${outHeight}%` }}
                    className="w-full max-w-[16px] bg-slate-700 rounded-t group-hover:bg-slate-600 transition-all relative"
                  >
                    <span className="opacity-0 group-hover:opacity-100 absolute -top-7 left-1/2 -translate-x-1/2 bg-black/80 px-1.5 py-0.5 rounded text-[10px] text-slate-300 font-bold transition">
                      {slot.out}
                    </span>
                  </div>
                </div>
                <span className="text-[11px] text-slate-500 mt-2 font-medium">{slot.hour}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
