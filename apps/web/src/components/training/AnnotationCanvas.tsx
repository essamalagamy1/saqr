'use client';

import React, { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';

export interface StudioBox {
  id: string;
  classId: number;
  x: number; // percentage 0-100
  y: number; // percentage 0-100
  width: number; // percentage 0-100
  height: number; // percentage 0-100
  score?: number;
}

export interface ClassMeta {
  id: number;
  name: string;
  labelAr: string;
  color: string;
}

interface AnnotationCanvasProps {
  imageUrl: string;
  boxes: StudioBox[];
  classes: ClassMeta[];
  activeClassId: number;
  isNegative?: boolean;
  onAddBox: (box: StudioBox) => void;
  onRemoveBox: (boxId: string) => void;
}

export function AnnotationCanvas({
  imageUrl,
  boxes,
  classes,
  activeClassId,
  isNegative = false,
  onAddBox,
  onRemoveBox,
}: AnnotationCanvasProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);

  const classMap = new Map(classes.map(c => [c.id, c]));
  const activeClass = classMap.get(activeClassId) || classes[0];

  const getRelativePercent = (clientX: number, clientY: number) => {
    const el = overlayRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    const x = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100));
    return { x, y };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isNegative || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = getRelativePercent(e.clientX, e.clientY);
    setDragStart(pt);
    setDragCurrent(pt);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart) return;
    setDragCurrent(getRelativePercent(e.clientX, e.clientY));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart) return;
    const endPt = dragCurrent || getRelativePercent(e.clientX, e.clientY);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}

    const left = Math.min(dragStart.x, endPt.x);
    const top = Math.min(dragStart.y, endPt.y);
    const width = Math.abs(endPt.x - dragStart.x);
    const height = Math.abs(endPt.y - dragStart.y);

    setDragStart(null);
    setDragCurrent(null);

    if (width >= 1.2 && height >= 1.2) {
      onAddBox({
        id: `box_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        classId: activeClassId,
        x: parseFloat(left.toFixed(2)),
        y: parseFloat(top.toFixed(2)),
        width: parseFloat(width.toFixed(2)),
        height: parseFloat(height.toFixed(2)),
      });
    }
  };

  const draftRect =
    dragStart && dragCurrent
      ? {
          x: Math.min(dragStart.x, dragCurrent.x),
          y: Math.min(dragStart.y, dragCurrent.y),
          width: Math.abs(dragCurrent.x - dragStart.x),
          height: Math.abs(dragCurrent.y - dragStart.y),
        }
      : null;

  return (
    <div className="relative w-full rounded-xl border border-slate-800 bg-[#050811] flex items-center justify-center p-2 min-h-[340px] max-h-[520px] overflow-hidden">
      {/* Shrink-wrapped container matches exact rendered image dimensions; dir="ltr" ensures percentage coords match YOLO */}
      <div
        ref={overlayRef}
        dir="ltr"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          setDragStart(null);
          setDragCurrent(null);
        }}
        className={`relative inline-block select-none touch-none ${
          isNegative ? 'cursor-not-allowed opacity-85' : 'cursor-crosshair'
        }`}
      >
        <img
          src={imageUrl}
          alt="Training sample"
          draggable={false}
          className="block max-h-[480px] max-w-full w-auto h-auto rounded-md select-none pointer-events-none"
        />

        {/* Negative Sample Watermark */}
        {isNegative && (
          <div
            dir="rtl"
            className="absolute inset-0 bg-slate-950/40 flex items-center justify-center pointer-events-none rounded-md border-2 border-dashed border-emerald-500/60"
          >
            <span className="bg-emerald-950/90 border border-emerald-500/50 text-emerald-300 px-3 py-1.5 rounded-lg text-xs font-bold shadow-lg">
              صورة سلبية (بدون مخالفة — لتقليل الإنذارات الكاذبة)
            </span>
          </div>
        )}

        {/* Saved Boxes */}
        {!isNegative &&
          boxes.map(box => {
            const cls = classMap.get(box.classId) || activeClass;
            const color = cls?.color || '#38bdf8';
            return (
              <div
                key={box.id}
                className="absolute border-2 rounded-sm group"
                style={{
                  left: `${box.x}%`,
                  top: `${box.y}%`,
                  width: `${box.width}%`,
                  height: `${box.height}%`,
                  borderColor: color,
                  backgroundColor: `${color}20`,
                }}
              >
                <div
                  dir="rtl"
                  className={`absolute ${box.y < 10 ? 'top-0.5' : '-top-6'} left-0 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold text-white shadow-md whitespace-nowrap bg-slate-950/95 border border-slate-700`}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                  <span>{cls?.labelAr || `Class ${box.classId}`}</span>
                  {box.score !== undefined && (
                    <span className="font-mono text-slate-400">{Math.round(box.score * 100)}%</span>
                  )}
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      onRemoveBox(box.id);
                    }}
                    title="حذف المربع"
                    className="mr-1 text-rose-400 hover:text-rose-300 cursor-pointer"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            );
          })}

        {/* Active Drag Preview */}
        {draftRect && draftRect.width > 0.4 && draftRect.height > 0.4 && (
          <div
            className="absolute border-2 border-dashed rounded-sm pointer-events-none"
            style={{
              left: `${draftRect.x}%`,
              top: `${draftRect.y}%`,
              width: `${draftRect.width}%`,
              height: `${draftRect.height}%`,
              borderColor: activeClass?.color || '#38bdf8',
              backgroundColor: `${activeClass?.color || '#38bdf8'}26`,
            }}
          />
        )}
      </div>
    </div>
  );
}
