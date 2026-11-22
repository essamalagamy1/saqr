'use client';

import React, { useEffect, useState, useRef } from 'react';
import { 
  Bell, Search, Building2, 
  ExternalLink, LogOut, Copy, Menu
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getValidToken, api } from '@/lib/api';

interface LiveAlert {
  id: string;
  camera_name: string;
  branch_name: string;
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
  const [copiedOrg, setCopiedOrg] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [notificationsList, setNotificationsList] = useState<LiveAlert[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('rased_user');
      if (saved) setCurrentUser(JSON.parse(saved));
    } catch {}
  }, []);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Play pleasant synthesizer beep for alert
  const playAlertSound = (isSiren = false) => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      if (isSiren) {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(1400, ctx.currentTime + 0.3);
        osc.frequency.linearRampToValueAtTime(800, ctx.currentTime + 0.6);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.9);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.9);
      } else {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, ctx.currentTime);
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      }
    } catch (e) {
      // Audio context might be restricted before first user interaction
    }
  };

  useEffect(() => {
    // Load initial real unread count
    api.get<any>('/detections/stats').then((data) => {
      if (data && typeof data.unread_detections === 'number') {
        setUnreadCount(data.unread_detections);
      }
    }).catch(() => {});

    // EventSource streaming reader with valid token
    const controller = new AbortController();

    async function startSSE() {
      try {
        const token = await getValidToken();
        const response = await fetch('/api/v1/events/stream', {
          headers: {
            'Authorization': `Bearer ${token}`
          },
          signal: controller.signal
        });

        if (!response.body) return;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value);
          const lines = text.split('\n');

          for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('data: ')) {
              const dataStr = lines[i].substring(6).trim();
              if (!dataStr || dataStr === '{}') continue;

              try {
                const parsed = JSON.parse(dataStr);
                if (parsed.type && parsed.camera_name) {
                  // New detection alert received (silently update bell notifications)
                  setNotificationsList(prev => [parsed, ...prev.slice(0, 9)]);
                  setUnreadCount(prev => prev + 1);
                }
              } catch (err) {
                // Ignore parse errors on raw pings
              }
            }
          }
        }
      } catch (err) {
        // SSE disconnected or aborted
      }
    }

    startSSE();

    return () => {
      controller.abort();
    };
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    router.push(`/detections?search=${encodeURIComponent(searchQuery.trim())}`);
  };

  const handleCopyOrg = () => {
    const orgId = currentUser?.company_id || (typeof window !== 'undefined' ? localStorage.getItem('rased_company_id') : '') || '';
    if (orgId) {
      navigator.clipboard.writeText(orgId);
      setCopiedOrg(true);
      setTimeout(() => setCopiedOrg(false), 2000);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('rased_token');
    localStorage.removeItem('rased_user');
    router.push('/login');
  };

  return (
    <>
      <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-slate-800/80 bg-[#0b1120]/95 px-3 sm:px-6 backdrop-blur">
        {/* Right side: Mobile Hamburger + Branch select + Search */}
        <div className="flex items-center gap-2 sm:gap-4">
          {/* Mobile Navigation Toggle Button */}
          <button
            type="button"
            onClick={onToggleMobileNav}
            className="lg:hidden p-2 rounded-lg border border-slate-800 bg-slate-900/80 text-slate-300 hover:text-white hover:bg-slate-800 transition shadow-sm cursor-pointer"
            title="القائمة الرئيسية"
            aria-label="Toggle navigation menu"
          >
            <Menu className="h-5 w-5 text-amber-500" />
          </button>

          {/* Branch Selector Pill */}
          <div className="flex items-center gap-1.5 sm:gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm text-slate-300">
            <Building2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-amber-500 shrink-0" />
            <span className="font-medium text-slate-200 truncate max-w-[120px] sm:max-w-none">
              فرع القاهرة الجديدة
            </span>
          </div>

          <form onSubmit={handleSearchSubmit} className="relative w-64 xl:w-72 hidden md:block">
            <Search className="absolute right-3 top-2.5 h-4 w-4 text-slate-500" />
            <input
              type="text"
              placeholder="بحث سريع واضغط Enter..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-slate-900/60 py-1.5 pr-9 pl-4 text-sm text-slate-200 placeholder-slate-500 focus:border-amber-500 focus:outline-none"
            />
          </form>
        </div>

        {/* Left side: System status + Notifications + Profile */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Real-time Online Indicator */}
          <div className="flex items-center gap-1.5 sm:gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2 sm:px-3 py-1.5 text-[11px] sm:text-xs text-emerald-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
            </span>
            <span className="font-medium hidden sm:inline">المعالجة متصلة (YOLOX)</span>
            <span className="font-medium sm:hidden">YOLOX</span>
          </div>

          {/* Notifications Icon with Badge */}
          <div className="relative">
            <button 
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative cursor-pointer rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-slate-400 hover:text-slate-200 hover:border-slate-700 transition"
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-sm shadow-red-500/50">
                  {unreadCount > 99 ? '+99' : unreadCount}
                </span>
              )}
            </button>

            {/* Notifications Dropdown */}
            {showNotifications && (
              <div className="absolute left-0 mt-2 w-72 sm:w-80 max-w-[calc(100vw-32px)] rounded-xl border border-slate-800 bg-slate-900/95 p-3 shadow-2xl backdrop-blur-md z-50 animate-in fade-in slide-in-from-top-2">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <span className="text-xs font-bold text-slate-200">أحدث تنبيهات الرصد</span>
                  <button 
                    onClick={() => { setUnreadCount(0); setShowNotifications(false); }}
                    className="text-[11px] text-amber-400 hover:underline"
                  >
                    تحديد الكل كمقروء
                  </button>
                </div>
                <div className="mt-2 space-y-2 max-h-72 overflow-y-auto">
                  {notificationsList.length === 0 ? (
                    <div className="py-6 text-center text-xs text-slate-500">لا توجد تنبيهات جديدة في الوقت الحالي</div>
                  ) : (
                    notificationsList.map((notif, idx) => (
                      <div key={idx} className="rounded-lg border border-slate-800/80 bg-slate-800/40 p-2.5 text-xs text-slate-300 hover:bg-slate-800/70 transition">
                        <div className="flex items-center justify-between font-semibold text-amber-400">
                          <span>{notif.type}</span>
                          <span className="text-[10px] text-slate-500">{new Date(notif.detected_at).toLocaleTimeString('ar-EG')}</span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-1">{notif.camera_name} • {notif.branch_name}</div>
                      </div>
                    ))
                  )}
                </div>
                <div className="mt-2 pt-2 border-t border-slate-800 text-center">
                  <Link href="/detections" onClick={() => setShowNotifications(false)} className="text-xs font-semibold text-amber-400 hover:underline inline-flex items-center gap-1">
                    <span>عرض سجل الاكتشافات كاملاً</span>
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            )}
          </div>

          {/* User Account / Organization Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowProfileMenu(!showProfileMenu)}
              className="flex items-center gap-3 border-r border-slate-800 pr-3 cursor-pointer text-right hover:opacity-90 transition"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-amber-600 font-bold text-black text-sm shadow-sm">
                {(currentUser?.company_name || currentUser?.name || 'ص').charAt(0).toUpperCase()}
              </div>
              <div className="hidden sm:block">
                <div className="text-xs font-semibold text-slate-200">
                  {currentUser?.company_name || 'منظومة صَقْر'}
                </div>
                <div className="text-[10px] text-slate-400">
                  {currentUser?.email || 'admin@saqr.ai'}
                </div>
              </div>
            </button>

            {showProfileMenu && (
              <div className="absolute left-0 mt-2 w-56 rounded-xl border border-slate-800 bg-slate-900/95 p-2 shadow-2xl backdrop-blur-md z-50 text-xs">
                <div className="px-3 py-2 border-b border-slate-800">
                  <div className="font-bold text-slate-200">
                    {currentUser?.company_name || 'شركة معتمدة'}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {currentUser?.name || 'مدير النظام'} ({currentUser?.role || 'Admin'})
                  </div>
                </div>

                <div className="py-1">
                  <button
                    onClick={handleCopyOrg}
                    className="w-full flex items-center justify-between px-3 py-2 text-slate-300 hover:bg-slate-800 rounded-lg transition"
                  >
                    <span>معرف الشركة</span>
                    <span className="flex items-center gap-1 text-[10px] text-amber-400">
                      {copiedOrg ? 'تم النسخ!' : <Copy className="h-3 w-3" />}
                    </span>
                  </button>

                  <Link
                    href="/branches"
                    onClick={() => setShowProfileMenu(false)}
                    className="w-full flex items-center justify-between px-3 py-2 text-slate-300 hover:bg-slate-800 rounded-lg transition"
                  >
                    <span>إدارة الفروع والمواقع</span>
                    <Building2 className="h-3.5 w-3.5 text-slate-500" />
                  </Link>
                </div>

                <div className="pt-1 border-t border-slate-800">
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center justify-between px-3 py-2 text-red-400 hover:bg-red-500/10 rounded-lg transition font-medium"
                  >
                    <span>تسجيل الخروج</span>
                    <LogOut className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>
    </>
  );
}
