'use client';

import { RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { type KeyboardEvent, type PointerEvent, useRef, useState } from 'react';

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.5;

const clampZoom = (value: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

const distance = (points: { x: number; y: number }[]): number => {
  const [first, second] = points;

  if (!first || !second) {
    return 0;
  }

  return Math.hypot(first.x - second.x, first.y - second.y);
};

type SourcePreviewProps = {
  /** Owner-only original photo URL (personal recognition or team roster source). */
  src: string;
  /** Image description (personal: "내가 올린 근무표 원본", team: "팀 근무표 원본"). */
  alt?: string;
};

/**
 * Owner-only original photo (served no-store). Zoom with buttons, +/- keys or a two-finger pinch;
 * the frame scrolls so a zoomed image can be panned by touch, mouse wheel or arrow keys.
 */
const SourcePreview = ({ src, alt = '내가 올린 근무표 원본' }: SourcePreviewProps) => {
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [hasError, setHasError] = useState(false);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);

  const handleZoomIn = () => setZoom((value) => clampZoom(value + ZOOM_STEP));
  const handleZoomOut = () => setZoom((value) => clampZoom(value - ZOOM_STEP));
  const handleReset = () => setZoom(MIN_ZOOM);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      handleZoomIn();
    }

    if (event.key === '-') {
      event.preventDefault();
      handleZoomOut();
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size === 2) {
      pinchRef.current = { distance: distance([...pointersRef.current.values()]), zoom };
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) {
      return;
    }

    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const pinch = pinchRef.current;

    if (pinch && pointersRef.current.size === 2 && pinch.distance > 0) {
      setZoom(clampZoom((pinch.zoom * distance([...pointersRef.current.values()])) / pinch.distance));
    }
  };

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);

    if (pointersRef.current.size < 2) {
      pinchRef.current = null;
    }
  };

  if (hasError) {
    return (
      <div className="warning" role="status">
        원본 사진을 불러올 수 없어요. 보관 기간이 지났거나 이미 삭제되었어요.
      </div>
    );
  }

  return (
    <div className="source-preview">
      <div
        className="source-frame"
        tabIndex={0}
        role="region"
        aria-label={`원본 근무표 사진, 확대 ${Math.round(zoom * 100)}%. 더하기·빼기 키로 확대·축소`}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- private no-store image, not optimizable */}
        <img
          src={src}
          alt={alt}
          style={{ width: `${zoom * 100}%` }}
          draggable={false}
          onError={() => setHasError(true)}
        />
      </div>
      <div className="zoom-controls">
        <button
          type="button"
          className="icon-button"
          onClick={handleZoomOut}
          disabled={zoom <= MIN_ZOOM}
          aria-label="축소"
        >
          <ZoomOut size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={handleZoomIn}
          disabled={zoom >= MAX_ZOOM}
          aria-label="확대"
        >
          <ZoomIn size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={handleReset}
          disabled={zoom === MIN_ZOOM}
          aria-label="원래 크기"
        >
          <RotateCcw size={18} aria-hidden="true" />
        </button>
        <span className="tiny" aria-hidden="true">
          {Math.round(zoom * 100)}%
        </span>
      </div>
    </div>
  );
};

export default SourcePreview;
