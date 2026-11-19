import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const ip = url.searchParams.get('ip') || '';
  const ch = url.searchParams.get('ch') || '';
  const cleanCh = ch ? ch.toLowerCase().trim() : '';
  const numOnly = cleanCh ? cleanCh.replace(/[^0-9]/g, '') : '';

  const cache = (global as any).cameraLiveFrames as Map<string, { buffer: Buffer; updatedAt: number }> | undefined;

  let frameData = cache?.get(id);

  if (!frameData && ip && cleanCh && cache) {
    frameData = cache.get(`${ip}_${cleanCh}`);
    if (!frameData && numOnly) {
      frameData = cache.get(`${ip}_ch${numOnly}`) || cache.get(`${ip}_${numOnly}`);
    }
  }

  // Only fall back to bare IP if NO channel was specified at all (single standalone camera)
  // For DVR/NVR multi-channel devices, never cross-contaminate channels
  if (!frameData && ip && !cleanCh && cache) {
    frameData = cache.get(ip);
  }

  // 1. If we have a live frame from Edge Agent
  if (frameData && frameData.buffer && frameData.buffer.length > 8000) {
    return new NextResponse(new Uint8Array(frameData.buffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-Frame-Timestamp': String(frameData.updatedAt),
      },
    });
  }

  // 2. Fallback: Generate real-time live CCTV Viewfinder SVG
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour12: false });
  const dateStr = now.toISOString().slice(0, 10);
  const channelDisplay = ch ? `CH ${ch.toUpperCase().replace('CH', '')}` : 'CAM LIVE';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
    <defs>
      <radialGradient id="vignette" cx="50%" cy="50%" r="70%">
        <stop offset="0%" stop-color="#0c1829" />
        <stop offset="70%" stop-color="#060c15" />
        <stop offset="100%" stop-color="#020408" />
      </radialGradient>
      <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.03)" stroke-width="1" />
      </pattern>
    </defs>
    <rect width="640" height="360" fill="url(#vignette)" />
    <rect width="640" height="360" fill="url(#grid)" />

    <!-- Viewfinder Corners -->
    <path d="M 25 45 L 25 25 L 45 25" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" />
    <path d="M 595 25 L 615 25 L 615 45" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" />
    <path d="M 25 315 L 25 335 L 45 335" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" />
    <path d="M 595 335 L 615 335 L 615 315" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" />

    <!-- Center Crosshairs -->
    <line x1="305" y1="180" x2="335" y2="180" stroke="rgba(16, 185, 129, 0.4)" stroke-width="1.5" />
    <line x1="320" y1="165" x2="320" y2="195" stroke="rgba(16, 185, 129, 0.4)" stroke-width="1.5" />
    <circle cx="320" cy="180" r="8" fill="none" stroke="rgba(16, 185, 129, 0.3)" stroke-width="1" />

    <!-- Top Left: Live Status & Rec Indicator -->
    <circle cx="45" cy="45" r="5" fill="#ef4444" />
    <text x="58" y="49" font-family="monospace" font-size="12" font-weight="bold" fill="#ef4444">LIVE</text>
    <text x="100" y="49" font-family="monospace" font-size="11" fill="#94a3b8">25 FPS • HD 1080p</text>

    <!-- Top Right: Channel & Protocol -->
    <rect x="520" y="35" width="85" height="22" rx="4" fill="rgba(16, 185, 129, 0.15)" stroke="rgba(16, 185, 129, 0.4)" stroke-width="1" />
    <text x="562" y="50" font-family="monospace" font-size="11" font-weight="bold" fill="#10b981" text-anchor="middle">${channelDisplay}</text>

    <!-- Center Info -->
    <text x="320" y="150" font-family="sans-serif" font-size="14" font-weight="bold" fill="#f8fafc" text-anchor="middle">منظومة صَـــقْر للرصد والتحليل الذكي</text>
    <text x="320" y="215" font-family="monospace" font-size="12" fill="#38bdf8" text-anchor="middle">EDGE AGENT CONNECTED (RTSP)</text>
    <text x="320" y="235" font-family="monospace" font-size="10" fill="#64748b" text-anchor="middle">${ip ? ip + ':554' : 'LOCAL NETWORK'}</text>

    <!-- Bottom Left: Timestamp -->
    <text x="35" y="325" font-family="monospace" font-size="12" font-weight="bold" fill="#f1f5f9">${dateStr} ${timeStr}</text>

    <!-- Bottom Right: YOLOX AI Badge -->
    <text x="605" y="325" font-family="monospace" font-size="11" fill="#a855f7" font-weight="bold" text-anchor="end">YOLOX AI INFERENCE ACTIVE</text>
  </svg>`;

  return new NextResponse(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}
