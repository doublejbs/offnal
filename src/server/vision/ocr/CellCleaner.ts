import { OcrCellInk } from '@/domain/enums/OcrCellInk';
import { type Component, labelComponents } from '@/server/vision/ocr/ConnectedComponents';
import {
  computeLocalMeans,
  computeOtsuThreshold,
  createGray,
  cropGray,
  type GrayImage,
} from '@/server/vision/ocr/GrayRaster';
import { type PixelRect } from '@/server/vision/VisionGeometry';

export type CleanCellOptions = {
  /** Share of the cell trimmed on each side before reading (keeps grid lines out). */
  inset: number;
  /** Drop components enclosing another one (hand-drawn circles around a code). */
  dropEnclosing: boolean;
  /**
   * Keep only the glyph cluster at the cell center (retry for unresolved cells): drops circle arcs and
   * highlighter edges that survive the other filters.
   */
  focusCenter?: boolean;
};

/** Glyphs of one cell, cropped to the kept components. */
export type CleanCell = {
  ink: OcrCellInk;
  /** Binary: 1 = ink. */
  glyphs: GrayImage | null;
  /** Anti-aliased gray (0 = ink, 255 = paper) of the kept glyphs only, contrast stretched (for OCR). */
  shades: GrayImage | null;
  /** Kept ink pixels / cell area (0 for blank). */
  inkShare: number;
};

/** Ink must differ from the background by this many gray levels, or the cell is blank. */
const MIN_CONTRAST = 45;
/** Local window radius (share of the cell height) and how much darker than it ink must be. */
const LOCAL_RADIUS_SHARE = 0.35;
const LOCAL_DARK_SHARE = 0.9;
/** Components smaller than this share of the cell area are specks. */
const MIN_COMPONENT_SHARE = 0.002;
/** A border-touching component longer than this share of the cell side is a grid line remnant. */
const LINE_REMNANT_SHARE = 0.6;
/** A dash is at most this share of the cell height tall and at least this many times wider than tall. */
const DASH_MAX_HEIGHT_SHARE = 0.18;
const DASH_MIN_ASPECT = 1.8;

const BLANK_CELL: CleanCell = { ink: OcrCellInk.BLANK, glyphs: null, shades: null, inkShare: 0 };

const touchesBorder = (component: Component, width: number, height: number): boolean =>
  component.left === 0 ||
  component.top === 0 ||
  component.right === width - 1 ||
  component.bottom === height - 1;

const boxWidth = (component: Component): number => component.right - component.left + 1;

const boxHeight = (component: Component): number => component.bottom - component.top + 1;

const encloses = (outer: Component, inner: Component): boolean =>
  outer !== inner &&
  outer.left <= inner.left &&
  outer.right >= inner.right &&
  outer.top <= inner.top &&
  outer.bottom >= inner.bottom;

/** Removes specks, grid-line remnants and (optionally) circles; the rest are the cell's glyphs. */
const keepGlyphs = (components: Component[], width: number, height: number, options: CleanCellOptions) => {
  const minCount = width * height * MIN_COMPONENT_SHARE;
  const sized = components.filter((component) => component.count >= minCount);
  const withoutLines = sized.filter(
    (component) =>
      !touchesBorder(component, width, height) ||
      (boxWidth(component) < width * LINE_REMNANT_SHARE &&
        boxHeight(component) < height * LINE_REMNANT_SHARE),
  );

  const glyphs = options.dropEnclosing
    ? withoutLines.filter((component) => !withoutLines.some((other) => encloses(component, other)))
    : withoutLines;

  return options.focusCenter ? focusOnCenter(glyphs, width, height) : glyphs;
};

/** Center cluster: the biggest component near the center, plus components on its text line and close by. */
const focusOnCenter = (components: Component[], width: number, height: number): Component[] => {
  const centerDistance = (component: Component) =>
    Math.hypot(
      (component.left + component.right) / 2 - width / 2,
      (component.top + component.bottom) / 2 - height / 2,
    );
  const central = components.filter(
    (component) => centerDistance(component) <= Math.min(width, height) * 0.45,
  );
  const anchor = central.sort((a, b) => b.count - a.count)[0];

  if (!anchor) {
    return [];
  }

  const anchorHeight = boxHeight(anchor);

  return components.filter((component) => {
    const overlap = Math.min(component.bottom, anchor.bottom) - Math.max(component.top, anchor.top) + 1;
    const gap = Math.max(component.left - anchor.right, anchor.left - component.right, 0);

    return (
      component === anchor ||
      (overlap >= boxHeight(component) * 0.6 &&
        boxHeight(component) <= anchorHeight * 1.3 &&
        boxHeight(component) >= anchorHeight * 0.5 &&
        gap <= anchorHeight * 0.6)
    );
  });
};

/** Mean gray of the pixels on each side of the threshold (ink, paper). */
const measureLevels = (image: GrayImage, threshold: number): { ink: number; paper: number } => {
  let darkSum = 0;
  let darkCount = 0;
  let lightSum = 0;
  let lightCount = 0;

  for (const value of image.data) {
    if (value <= threshold) {
      darkSum += value;
      darkCount += 1;
    } else {
      lightSum += value;
      lightCount += 1;
    }
  }

  return darkCount === 0 || lightCount === 0
    ? { ink: 0, paper: 0 }
    : { ink: darkSum / darkCount, paper: lightSum / lightCount };
};

const WHITE = 255;

/** Gray copy of `box` keeping only pixels on or next to kept ink, stretched so ink → 0 and paper → 255. */
const buildShades = (
  crop: GrayImage,
  labels: Int32Array,
  keptLabels: ReadonlySet<number>,
  box: PixelRect,
  levels: { ink: number; paper: number },
): GrayImage => {
  const shades = createGray(box.right - box.left, box.bottom - box.top);
  const range = Math.max(1, levels.paper - levels.ink);
  const isKept = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < crop.width && y < crop.height && keptLabels.has(labels[y * crop.width + x]!);

  for (let y = box.top; y < box.bottom; y += 1) {
    for (let x = box.left; x < box.right; x += 1) {
      const nearInk =
        isKept(x, y) || isKept(x - 1, y) || isKept(x + 1, y) || isKept(x, y - 1) || isKept(x, y + 1);
      const stretched = ((crop.data[y * crop.width + x]! - levels.ink) / range) * WHITE;

      shades.data[(y - box.top) * shades.width + (x - box.left)] = nearInk
        ? Math.max(0, Math.min(WHITE, stretched))
        : WHITE;
    }
  }

  return shades;
};

/**
 * Isolates the glyphs of one table cell (Spec §20): trims the borders, binarizes with Otsu (works on
 * colored weekend backgrounds and highlighter), drops specks, grid-line remnants and circles, and
 * classifies the result as blank, dash or text.
 */
export const cleanCell = (gray: GrayImage, rect: PixelRect, options: CleanCellOptions): CleanCell => {
  const insetX = (rect.right - rect.left) * options.inset;
  const insetY = (rect.bottom - rect.top) * options.inset;
  const crop = cropGray(gray, {
    left: rect.left + insetX,
    top: rect.top + insetY,
    right: rect.right - insetX,
    bottom: rect.bottom - insetY,
  });
  const { width, height } = crop;

  if (width < 4 || height < 4) {
    return BLANK_CELL;
  }

  const threshold = computeOtsuThreshold(crop, { left: 0, top: 0, right: width, bottom: height });

  const levels = measureLevels(crop, threshold);

  if (levels.paper - levels.ink < MIN_CONTRAST) {
    return BLANK_CELL;
  }

  // Ink must be dark globally (Otsu) and locally: a highlighter patch is darker than the paper but not than
  // its own surroundings, so the code inside it stays separate from the patch.
  const binary = createGray(width, height);
  const localMeans = computeLocalMeans(crop, Math.max(3, Math.round(height * LOCAL_RADIUS_SHARE)));

  crop.data.forEach((value, index) => {
    binary.data[index] = value <= threshold && value < localMeans[index]! * LOCAL_DARK_SHARE ? 1 : 0;
  });

  const { labels, components } = labelComponents(binary);
  const kept = keepGlyphs(components, width, height, options);

  if (kept.length === 0) {
    return BLANK_CELL;
  }

  const box = {
    left: Math.min(...kept.map((component) => component.left)),
    top: Math.min(...kept.map((component) => component.top)),
    right: Math.max(...kept.map((component) => component.right)) + 1,
    bottom: Math.max(...kept.map((component) => component.bottom)) + 1,
  };
  const keptLabels = new Set(kept.map((component) => component.label));
  const glyphs = createGray(box.right - box.left, box.bottom - box.top);
  let inkCount = 0;

  for (let y = box.top; y < box.bottom; y += 1) {
    for (let x = box.left; x < box.right; x += 1) {
      if (keptLabels.has(labels[y * width + x]!)) {
        glyphs.data[(y - box.top) * glyphs.width + (x - box.left)] = 1;
        inkCount += 1;
      }
    }
  }

  const isDash =
    kept.length === 1 &&
    glyphs.height <= height * DASH_MAX_HEIGHT_SHARE &&
    glyphs.width >= glyphs.height * DASH_MIN_ASPECT;

  return {
    ink: isDash ? OcrCellInk.DASH : OcrCellInk.TEXT,
    glyphs,
    shades: buildShades(crop, labels, keptLabels, box, levels),
    inkShare: inkCount / (width * height),
  };
};
