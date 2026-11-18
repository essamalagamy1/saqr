'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Lock, Mail, AlertCircle, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('fitforless@rased.com');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('يرجى ملء جميع الحقول المطلوبة');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const res = await fetch('http://localhost:8080/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (res.ok && data.success && data.data?.tokens?.access_token) {
        localStorage.setItem('rased_token', data.data.tokens.access_token);
        if (data.data.user) {
          localStorage.setItem('rased_user', JSON.stringify(data.data.user));
          localStorage.setItem('rased_company_id', data.data.user.company_id);
        }
        router.push('/');
      } else {
        setError(data.error || 'البريد الإلكتروني أو كلمة المرور غير صحيحة');
      }
    } catch (err: any) {
      setError('تعذر الاتصال بخادم الـ API. تأكد من تشغيل السيرفر.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0b1120] p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0d1527] p-8 shadow-2xl">
        {/* Logo and Header */}
        <div className="text-center mb-8">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 shadow-xl shadow-amber-500/20 mb-3">
            <ShieldCheck className="h-7 w-7 text-black stroke-[2.5]" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">صَـــــقْر</h1>
          <p className="text-xs text-slate-400 mt-1">منصة المراقبة والتحليل الذكي لكاميرات المنشآت</p>
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-400 font-semibold mb-1.5">البريد الإلكتروني</label>
            <div className="relative">
              <Mail className="absolute right-3 top-2.5 h-4 w-4 text-slate-500" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 py-2.5 pr-9 pl-4 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-400 font-semibold mb-1.5">كلمة المرور</label>
            <div className="relative">
              <Lock className="absolute right-3 top-2.5 h-4 w-4 text-slate-500" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 py-2.5 pr-9 pl-4 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] pt-1">
            <label className="flex items-center gap-1.5 text-slate-400 cursor-pointer">
              <input type="checkbox" defaultChecked className="rounded border-slate-700 bg-slate-800 text-amber-500" />
              <span>تذكرني على هذا الجهاز</span>
            </label>
            <span className="text-amber-400 hover:underline cursor-pointer">بيانات تجريبية مسجلة مسبقاً</span>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 flex items-center justify-center gap-2 rounded-lg bg-amber-500 py-3 font-bold text-black text-sm hover:bg-amber-400 transition-colors shadow-lg shadow-amber-500/20 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'تسجيل الدخول'}
          </button>
        </form>

        <div className="mt-8 text-center text-[11px] text-slate-500 border-t border-slate-800 pt-4">
          الحساب الافتراضي: <span className="text-amber-400 font-mono">fitforless@rased.com</span> | كلمة المرور: <span className="text-amber-400 font-mono">password123</span>
        </div>
      </div>
    </div>
  );
}
