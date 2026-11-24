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
    <div className="min-h-screen bg-[#080c14] text-slate-100 flex flex-col antialiased selection:bg-sky-500/20 selection:text-sky-200">
      {/* Mobile Backdrop Overlay */}
      {mobileNavOpen && (
        <div
          onClick={() => setMobileNavOpen(false)}
          className="fixed inset-0 z-40 bg-black/80 backdrop-blur-xs lg:hidden transition-opacity"
        />
      )}

      {/* Responsive Sidebar (Off-canvas on mobile, fixed on desktop) */}
      <Sidebar
        isOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />

      {/* Main Content Area */}
      <div className="flex min-h-screen flex-col lg:mr-64 min-w-0 transition-all">
        <Header onToggleMobileNav={() => setMobileNavOpen((prev) => !prev)} />
        <main className="flex-1 p-4 sm:p-6 lg:p-8 min-w-0 max-w-[1600px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
