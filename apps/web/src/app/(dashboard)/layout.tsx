'use client';

import React, { useState } from 'react';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#0b1120] text-slate-100">
      {/* Mobile Backdrop Overlay */}
      {mobileNavOpen && (
        <div
          onClick={() => setMobileNavOpen(false)}
          className="fixed inset-0 z-40 bg-black/75 backdrop-blur-xs lg:hidden transition-opacity duration-300"
        />
      )}

      {/* Responsive Sidebar (Off-canvas on mobile, fixed on desktop) */}
      <Sidebar
        isOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />

      {/* Main Content Area: auto width fills remaining space (100% on mobile, calc(100% - 16rem) on desktop) */}
      <div className="flex min-h-screen flex-col lg:mr-64 min-w-0 transition-all">
        <Header onToggleMobileNav={() => setMobileNavOpen((prev) => !prev)} />
        <main className="flex-1 p-3.5 sm:p-5 md:p-6 min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
