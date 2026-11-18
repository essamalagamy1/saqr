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
  ShieldCheck
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

export function Sidebar() {
  const pathname = usePathname();
  const [counts, setCounts] = useState<{
    aiServices?: number;
    cameras?: number;
    detections?: number;
    tasks?: number;
  }>({});

  useEffect(() => {
    // Load live counts dynamically from DB
    Promise.all([
      api.get<any[]>('/ai-services/').catch(() => []),
      api.get<any[]>('/cameras/').catch(() => []),
      api.get<any>('/detections/stats').catch(() => null),
      api.get<any[]>('/tasks/').catch(() => []),
    ]).then(([services, cams, stats, tasks]) => {
      const activeCamsCount = Array.isArray(cams) ? cams.filter((c: any) => c.status === 'active' || c.status === 'online').length : 0;
      setCounts({
        aiServices: activeCamsCount > 0 && Array.isArray(services) ? services.filter((s: any) => s.is_active || s.status === 'active').length : 0,
        cameras: activeCamsCount,
        detections: activeCamsCount > 0 ? (stats?.unread_detections ?? 0) : 0,
        tasks: Array.isArray(tasks) ? tasks.filter((t: any) => t.status !== 'completed').length : 0,
      });
    });
  }, [pathname]);

  const navSections = [
    {
      title: 'لوحة التحكم',
      items: [
        { label: 'لوحة التحكم الرئيسية', href: '/', icon: LayoutDashboard },
        { label: 'التحليلات والتقارير', href: '/analytics', icon: TrendingUp },
      ],
    },
    {
      title: 'مركز الذكاء الاصطناعي',
      items: [
        { 
          label: 'خدمات الذكاء الاصطناعي', 
          href: '/ai-services', 
          icon: BrainCircuit, 
          badge: counts.aiServices && counts.aiServices > 0 ? String(counts.aiServices) : undefined 
        },
      ],
    },
    {
      title: 'المراقبة والعمليات',
      items: [
        { 
          label: 'البث المباشر للكاميرات', 
          href: '/live', 
          icon: Video, 
          badge: counts.cameras && counts.cameras > 0 ? String(counts.cameras) : undefined 
        },
        { 
          label: 'سجل الاكتشافات الموحد', 
          href: '/detections', 
          icon: AlertTriangle, 
          badge: counts.detections !== undefined && counts.detections > 0 ? String(counts.detections) : undefined 
        },
        { 
          label: 'إدارة المهام والمتابعة', 
          href: '/tasks', 
          icon: CheckSquare,
          badge: counts.tasks !== undefined && counts.tasks > 0 ? String(counts.tasks) : undefined
        },
      ],
    },
    {
      title: 'إدارة المنشأة',
      items: [
        { label: 'إدارة الكاميرات', href: '/cameras', icon: Camera },
        { label: 'الفروع والمواقع', href: '/branches', icon: Building2 },
      ],
    },
  ];

  return (
    <aside className="fixed right-0 top-0 z-40 h-screen w-64 border-l border-slate-800/80 bg-[#0d1527] transition-transform">
      {/* Brand Header */}
      <div className="flex h-16 items-center justify-between border-b border-slate-800/80 px-6">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 shadow-lg shadow-amber-500/20">
            <ShieldCheck className="h-5 w-5 text-black stroke-[2.5]" />
          </div>
          <div>
            <span className="text-lg font-bold tracking-tight text-white">صَـــــقْر</span>
            <span className="mr-1.5 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400 border border-amber-500/20">
              AI
            </span>
          </div>
        </Link>
      </div>

      {/* Navigation List */}
      <div className="h-[calc(100vh-4rem)] overflow-y-auto px-3 py-4">
        {navSections.map((section, idx) => (
          <div key={idx} className="mb-6">
            {section.title && (
              <h3 className="mb-2 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                {section.title}
              </h3>
            )}
            <ul className="space-y-1">
              {section.items.map((item) => {
                const isActive = pathname === item.href;
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        'group flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150',
                        isActive
                          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-sm'
                          : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Icon
                          className={cn(
                            'h-4 w-4 transition-colors',
                            isActive ? 'text-amber-400' : 'text-slate-400 group-hover:text-slate-200'
                          )}
                        />
                        <span>{item.label}</span>
                      </div>
                      {item.badge && (
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                            isActive
                              ? 'bg-amber-500 text-black font-bold'
                              : 'bg-slate-800 text-slate-300 group-hover:bg-slate-700'
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
    </aside>
  );
}
