import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'صَقْر | منصة المراقبة الذكية بالذكاء الاصطناعي',
  description: 'تحويل كاميرات المراقبة التقليدية إلى منظومة ذكية لرصد العمليات والسلامة والامتثال للمطاعم والمنشآت',
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
        className="min-h-screen bg-[#0b1120] text-slate-100 antialiased selection:bg-amber-500 selection:text-black"
      >
        {children}
      </body>
    </html>
  );
}
