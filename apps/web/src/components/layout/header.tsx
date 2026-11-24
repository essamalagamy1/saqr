'use client';

import React, { useEffect, useState, useRef } from 'react';
import { 
  Bell, 
  Search, 
  Building2, 
  Menu, 
  ShieldCheck, 
  Check, 
  ExternalLink,
  LogOut,
  Camera
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getValidToken, api } from '@/lib/api';

interface LiveAlert {
  id: string;
  camera_name: string;
  branch_name?: string;
  type: string;
  severity: string;
  confidence: number;
  snapshot_url?: string;
  detected_at: string;
}

interface HeaderProps {
  onToggleMobileNav?: () => void;
}

export function Header({ onToggleMobileNav }: HeaderProps) {
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [notificationsList, setNotificationsList] = useState<LiveAlert[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('rased_user');
      if (saved) setCurrentUser(JSON.parse(saved));
    } catch {}
  }, []);

  const playAlertSound = () => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch {}
  };

  useEffect(() => {
    api.get<any>('/detections/stats').then((data) => {
      if (data && typeof data.unread_detections === 'number') {
        setUnreadCount(data.unread_detections);
      }
    }).catch(() => {});

    // Poll recent alerts cleanly
    const pollAlerts = async () => {
      try {
        const dets = await api.get<any[]>('/detections/?limit=5');
        if (Array.isArray(dets)) {
          setNotificationsList(dets.slice(0, 5));
        }
      } catch {}
    };
    pollAlerts();
    const interval = setInterval(pollAlerts, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = () => {
    try {
      localStorage.removeItem('rased_access_token');
      localStorage.removeItem('rased_refresh_token');
      localStorage.removeItem('rased_user');
    } catch {}
    router.push('/login');
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-slate-800/80 bg-[#080c14]/95 px-4 sm:px-6 backdrop-blur-md">
      {/* Left Area (RTL: right side is Sidebar, this is the start) */}
      <div className="flex items-center gap-3">
        {/* Mobile Hamburger Button */}
        <button
          type="button"
          onClick={onToggleMobileNav}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-800 bg-slate-900/60 text-slate-300 hover:text-white hover:bg-slate-800 lg:hidden transition"
          aria-label="Toggle navigation menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Current Branch / Site Indicator */}
        <div className="hidden sm:flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/50 px-3 py-1.5 text-xs text-slate-300">
          <Building2 className="h-3.5 w-3.5 text-slate-400" />
          <span className="font-medium text-slate-200">الفرع الرئيسي — المنشأة الميدانية</span>
        </div>

        {/* Operational System Status Pill */}
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1 text-[11px] text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-medium">المعالجة الميدانية نشطة</span>
        </div>
      </div>

      {/* Right Area Controls */}
      <div className="flex items-center gap-2.5">
        {/* Notifications Dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-slate-800 bg-slate-900/50 text-slate-400 hover:text-slate-200 hover:border-slate-700 transition"
            title="التنبيهات اللحظية"
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-600 px-1 font-mono text-[9px] font-bold text-white shadow-sm">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute left-0 mt-2 w-80 sm:w-96 rounded-lg border border-slate-800 bg-[#0d131f] p-3 shadow-xl z-50">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-2 mb-2">
                <span className="text-xs font-bold text-white">آخر التنبيهات الميدانية</span>
                <Link
                  href="/detections"
                  onClick={() => setShowNotifications(false)}
                  className="text-[11px] text-sky-400 hover:text-sky-300 font-medium"
                >
                  عرض السجل بالكامل
                </Link>
              </div>

              {notificationsList.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-400">
                  لا توجد تنبيهات جديدة حالياً
                </div>
              ) : (
                <div className="space-y-1.5 max-h-72 overflow-y-auto">
                  {notificationsList.map((item) => (
                    <Link
                      key={item.id}
                      href={`/detections?highlight=${item.id}`}
                      onClick={() => setShowNotifications(false)}
                      className="flex items-start justify-between rounded-md p-2 hover:bg-slate-800/40 transition block"
                    >
                      <div className="space-y-0.5">
                        <div className="text-xs font-semibold text-slate-200">{item.type}</div>
                        <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
                          <Camera className="h-3 w-3" />
                          <span>{item.camera_name || 'كاميرا غير محددة'}</span>
                        </div>
                      </div>
                      <span className="font-mono text-[10px] text-slate-400">
                        {item.detected_at ? new Date(item.detected_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : ''}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* User Account Menu */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowProfileMenu(!showProfileMenu)}
            className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/50 p-1.5 sm:px-3 text-right hover:border-slate-700 transition"
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-800 text-xs font-bold text-slate-200 font-mono">
              {currentUser?.email ? currentUser.email.charAt(0).toUpperCase() : 'A'}
            </div>
            <div className="hidden md:block">
              <div className="text-xs font-medium text-slate-200 leading-tight">
                {currentUser?.name || 'مدير المنظومة'}
              </div>
              <div className="text-[10px] text-slate-400 leading-none mt-0.5">
                {currentUser?.email || 'admin@saqr.ai'}
              </div>
            </div>
          </button>

          {showProfileMenu && (
            <div className="absolute left-0 mt-2 w-48 rounded-lg border border-slate-800 bg-[#0d131f] p-1.5 shadow-xl z-50">
              <div className="px-3 py-2 border-b border-slate-800/80 mb-1">
                <div className="text-xs font-bold text-white">{currentUser?.name || 'مدير المنظومة'}</div>
                <div className="text-[10px] text-slate-400 font-mono truncate">{currentUser?.email || 'admin@saqr.ai'}</div>
              </div>
              <Link
                href="/cameras"
                onClick={() => setShowProfileMenu(false)}
                className="flex items-center gap-2 rounded-md px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800/60 hover:text-white transition"
              >
                <Camera className="h-3.5 w-3.5 text-slate-400" />
                <span>إدارة الكاميرات</span>
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="w-full flex items-center gap-2 rounded-md px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 transition mt-1"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>تسجيل الخروج</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
