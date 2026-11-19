'use client';

import React, { useState, useEffect, useRef } from 'react';

interface LiveStreamPlayerProps {
  cameraId: string;
  cameraName?: string;
  ip?: string;
  channel?: string;
  className?: string;
  intervalMs?: number;
  refreshTick?: number;
  objectFit?: 'cover' | 'contain';
}

export function LiveStreamPlayer({
  cameraId,
  cameraName = 'Camera Live',
  ip = '192.168.8.72',
  channel = 'CH1',
  className = 'w-full h-full select-none',
  intervalMs = 1500,
  refreshTick = 0,
  objectFit = 'cover',
}: LiveStreamPlayerProps) {
  const cleanIp = ip && ip.trim() ? ip.trim() : '192.168.8.72';
  const cleanCh = channel && channel.trim() ? channel.trim() : 'CH1';

  const buildUrl = () => {
    return `/api/cameras/${cameraId}/frame?ip=${encodeURIComponent(cleanIp)}&ch=${encodeURIComponent(cleanCh)}&t=${Date.now()}`;
  };

  const [displayedSrc, setDisplayedSrc] = useState<string>(() => buildUrl());
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;

    const fetchNextFrame = () => {
      const nextUrl = `/api/cameras/${cameraId}/frame?ip=${encodeURIComponent(cleanIp)}&ch=${encodeURIComponent(cleanCh)}&t=${Date.now()}`;
      const preloader = new Image();

      preloader.onload = () => {
        if (!isMountedRef.current) return;
        setDisplayedSrc(nextUrl);
      };

      // In case of network timeout or partial failure, keep showing current frame!
      // Do NOT revert to blank or null!
      preloader.onerror = () => {};

      preloader.src = nextUrl;
    };

    fetchNextFrame();
    const timer = setInterval(fetchNextFrame, intervalMs);

    return () => {
      isMountedRef.current = false;
      clearInterval(timer);
    };
  }, [cameraId, cleanIp, cleanCh, intervalMs, refreshTick]);

  return (
    <img
      src={displayedSrc}
      alt={cameraName}
      style={{ objectFit }}
      className={className}
      loading="eager"
      decoding="async"
    />
  );
}
