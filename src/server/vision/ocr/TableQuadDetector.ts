import { isValidQuad } from '@/server/vision/PerspectiveWarp';
import { type EdgeSample, fitEdgeLine, intersectEdges } from '@/server/vision/ocr/EdgeLineFit';
import { type Component, labelComponents } from '@/server/vision/ocr/ConnectedComponents';
import { buildInkMask, createGray, type GrayImage, toGrayChroma } from '@/server/vision/ocr/GrayRaster';
import { type Quad, type RawImage } from '@/server/vision/VisionGeometry';

/** Detection runs on a copy whose long edge is at most this (integer box downscale). */
export const DETECT_MAX_EDGE_PX = 1600;

/** Local-mean window radius as a share of the long edge. */
const MASK_RADIUS_SHARE = 1 / 60;
const MASK_DARK_SHARE = 0.85;
const MASK_MAX_CHROMA = 90;
/** The table component must cover at least this share of the image in bounding-box area. */
const MIN_BOX_SHARE = 0.05;
/** Border samples skip this share of each end (corners mix both directions). */
const EDGE_TRIM_SHARE = 0.04;
/** RANSAC inlier distance in detection pixels. */
const EDGE_TOLERANCE_PX = 2.5;

export type TableQuadDetection = {
  /** Outer border of the table in source pixels (TL, TR, BR, BL). */
  quad: Quad;
};

/** 3×3 binary dilation: bridges one-pixel breaks so the printed grid becomes one component. */
const dilate = (mask: GrayImage): GrayImage => {
  const out = createGray(mask.width, mask.height);

  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if (mask.data[y * mask.width + x] !== 1) {
        continue;
      }

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;

          if (nx >= 0 && ny >= 0 && nx < mask.width && ny < mask.height) {
            out.data[ny * mask.width + nx] = 1;
          }
        }
      }
    }
  }

  return out;
};

/** Outermost component pixel per scan line, as border samples of one edge. */
const collectBorder = (
  labels: Int32Array,
  width: number,
  component: Component,
  horizontal: boolean,
  fromStart: boolean,
): EdgeSample[] => {
  const samples: EdgeSample[] = [];
  const [alongStart, alongEnd] = horizontal
    ? [component.left, component.right]
    : [component.top, component.bottom];
  const [acrossStart, acrossEnd] = horizontal
    ? [component.top, component.bottom]
    : [component.left, component.right];
  const trim = Math.round((alongEnd - alongStart) * EDGE_TRIM_SHARE);

  for (let along = alongStart + trim; along <= alongEnd - trim; along += 1) {
    const step = fromStart ? 1 : -1;

    for (
      let across = fromStart ? acrossStart : acrossEnd;
      across >= acrossStart && across <= acrossEnd;
      across += step
    ) {
      const index = horizontal ? across * width + along : along * width + across;

      if (labels[index] === component.label) {
        samples.push({ along, across });
        break;
      }
    }
  }

  return samples;
};

/**
 * Finds the printed table without AI (Spec §20): adaptive ink mask on a downscaled gray copy, the largest
 * connected line component (the grid), its four borders fitted by RANSAC lines and intersected. Returns
 * null when nothing table-like is found or the quad is implausible (not convex, < 10% of the image).
 */
export const detectTableQuad = (image: RawImage): TableQuadDetection | null => {
  const factor = Math.max(1, Math.ceil(Math.max(image.width, image.height) / DETECT_MAX_EDGE_PX));
  const small = toGrayChroma(image, factor);
  const { width, height } = small.gray;
  const radius = Math.max(4, Math.round(Math.max(width, height) * MASK_RADIUS_SHARE));
  const mask = dilate(
    buildInkMask(small, { radius, darkShare: MASK_DARK_SHARE, maxChroma: MASK_MAX_CHROMA }),
  );
  const { labels, components } = labelComponents(mask);
  const table = components
    .filter((item) => (item.right - item.left) * (item.bottom - item.top) >= width * height * MIN_BOX_SHARE)
    .sort((a, b) => b.count - a.count)[0];

  if (!table) {
    return null;
  }

  const borders = [
    collectBorder(labels, width, table, true, true),
    collectBorder(labels, width, table, false, false),
    collectBorder(labels, width, table, true, false),
    collectBorder(labels, width, table, false, true),
  ];
  const lines = borders.map((samples) => fitEdgeLine(samples, EDGE_TOLERANCE_PX));
  const [top, right, bottom, left] = lines;

  if (!top || !right || !bottom || !left) {
    return null;
  }

  const corners = [
    intersectEdges(top, left),
    intersectEdges(top, right),
    intersectEdges(bottom, right),
    intersectEdges(bottom, left),
  ];

  if (corners.some((corner) => corner === null)) {
    return null;
  }

  // Detection pixel i covers source pixels [i·factor, (i+1)·factor): scale its center back.
  const quad = corners.map((corner) => ({
    x: (corner!.x + 0.5) * factor,
    y: (corner!.y + 0.5) * factor,
  })) as Quad;

  if (!isValidQuad(quad, image.width, image.height)) {
    return null;
  }

  return { quad };
};
