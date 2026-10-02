import { type GrayImage } from '@/server/vision/ocr/GrayRaster';

export type Component = {
  label: number;
  count: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/** 8-connected labeling (explicit stack); returns labels (0 = background) and component stats. */
export const labelComponents = (mask: GrayImage): { labels: Int32Array; components: Component[] } => {
  const { width, height } = mask;
  const labels = new Int32Array(width * height);
  const components: Component[] = [];
  const stack: number[] = [];

  for (let start = 0; start < labels.length; start += 1) {
    if (mask.data[start] !== 1 || labels[start] !== 0) {
      continue;
    }

    const label = components.length + 1;
    const component: Component = { label, count: 0, left: width, top: height, right: -1, bottom: -1 };

    labels[start] = label;
    stack.push(start);

    while (stack.length > 0) {
      const index = stack.pop()!;
      const x = index % width;
      const y = (index - x) / width;

      component.count += 1;
      component.left = Math.min(component.left, x);
      component.right = Math.max(component.right, x);
      component.top = Math.min(component.top, y);
      component.bottom = Math.max(component.bottom, y);

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          const next = ny * width + nx;

          if (
            nx >= 0 &&
            ny >= 0 &&
            nx < width &&
            ny < height &&
            mask.data[next] === 1 &&
            labels[next] === 0
          ) {
            labels[next] = label;
            stack.push(next);
          }
        }
      }
    }

    components.push(component);
  }

  return { labels, components };
};
