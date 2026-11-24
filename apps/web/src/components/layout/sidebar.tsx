'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Video,
  AlertTriangle,
  BrainCircuit,
  Camera,
  Building2,
  TrendingUp,
  CheckSquare,
  ShieldCheck,
  X,
  Radio
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ isOpen = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const [counts, setCounts] = useState<{
    cameras?: number;
    detections?: number;
  }>({});

  useEffect(() => {
    Promise.all([
      api.get<any[]>('/cameras/').catch(() => []),
      api.get<any>('/detections/stats').catch(() => null),
    ]).then(([cams, stats]) => {
      const activeCamsCount = Array.isArray(cams) ? cams.filter((c: any) => c.status === 'active' || c.status === 'online').length : 0;
      setCounts({
        cameras: activeCamsCount,
        detections: stats?.unread_detections ?? 0,
      });
    });
  }, [pathname]);

  const navSections = [
    {
      title: 'العمليات والمراقبة',
      items: [
        { label: 'لوحة العمليات', href: '/', icon: LayoutDashboard },
        { 
          label: 'البث المباشر (RTSP)', 
          href: '/live', 
          icon: Video, 
          badge: counts.cameras && counts.cameras > 0 ? String(counts.cameras) : undefined 
        },
        { 
          label: 'سجل المخالفات والأحداث', 
          href: '/detections', 
          icon: AlertTriangle, 
          badge: counts.detections && counts.detections > 0 ? String(counts.detections) : undefined,
          badgeAlert: true
        },
        { label: 'التحليلات ومعدلات الامتثال', href: '/analytics', icon: TrendingUp },
      ],
    },
    {
      title: 'إدارة الكاميرات والشبكة',
      items: [
        { label: 'الكاميرات وأجهزة DVR', href: '/cameras', icon: Camera },
        { label: 'الفروع والمواقع الميدانية', href: '/branches', icon: Building2 },
      ],
    },
    {
      title: 'محرك التحليل البصري',
      items: [
        { 
          label: 'نماذج YOLO26 المستقلة', 
          href: '/ai-services', 
          icon: BrainCircuit,
          badge: '3 نماذج'
        },
      ],
    },
  ];

  return (
    <aside
      className={cn(
        'fixed right-0 top-0 z-50 h-screen w-64 border-l border-slate-800/90 bg-[#090e17] transition-transform duration-200 ease-in-out lg:translate-x-0 flex flex-col',
        isOpen ? 'translate-x-0' : 'translate-x-full'
      )}
    >
      {/* Brand Header */}
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-800/80 px-5">
        <Link 
          href="/" 
          onClick={onClose}
          className="flex items-center gap-3 group"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400 group-hover:bg-sky-500/20 transition">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold tracking-tight text-white">صَـــــقْر</span>
              <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700/60">
                PRO
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-medium">نظام المراقبة والتحليل البصري</p>
          </div>
        </Link>

        {/* Mobile Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800/60 lg:hidden transition"
          title="إغلاق القائمة"
          aria-label="Close sidebar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Navigation List */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {navSections.map((section, idx) => (
          <div key={idx}>
            <h3 className="mb-2 px-2.5 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
              {section.title}
            </h3>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = pathname === item.href;
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onClose}
                      className={cn(
                        'group flex items-center justify-between rounded-md px-2.5 py-2 text-xs font-medium transition-colors',
                        isActive
                          ? 'bg-sky-500/10 text-sky-300 font-semibold border-r-2 border-sky-500'
                          : 'text-slate-400 hover:bg-slate-800/40 hover:text-slate-200'
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon
                          className={cn(
                            'h-4 w-4 shrink-0 transition-colors',
                            isActive ? 'text-sky-400' : 'text-slate-400 group-hover:text-slate-300'
                          )}
                        />
                        <span>{item.label}</span>
                      </div>
                      {item.badge && (
                        <span
                          className={cn(
                            'font-mono text-[10px] px-1.5 py-0.5 rounded',
                            isActive
                              ? 'bg-sky-500/20 text-sky-200 font-semibold'
                              : item.badgeAlert
                                ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                                : 'bg-slate-800/80 text-slate-400 group-hover:text-slate-300'
                          )}
                        >
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {/* Edge Agent Telemetry Footer */}
      <div className="shrink-0 border-t border-slate-800/80 p-3 bg-[#070b12]">
        <div className="rounded-md border border-slate-800/80 bg-slate-900/60 p-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="text-[11px] font-medium text-slate-300">Edge Agent</span>
            </div>
            <span className="font-mono text-[10px] text-slate-400">v1.4.0</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
            <span>نماذج YOLO26 النشطة</span>
            <span className="text-emerald-400 font-medium">3 متصلة</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
