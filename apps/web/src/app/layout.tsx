import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'صقر | منصة المراقبة والتحليل البصري الميداني',
  description: 'منظومة الذكاء الاصطناعي لرصد السلامة ومعدات الوقاية الشخصية عبر كاميرات المراقبة الميدانية',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#080c14',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl" className="dark" suppressHydrationWarning>
      <body 
        suppressHydrationWarning 
        className="min-h-screen bg-[#080c14] text-slate-100 antialiased selection:bg-sky-500/20 selection:text-sky-200"
      >
        {children}
      </body>
    </html>
  );
}
