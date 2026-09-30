/** Second-pass input pipeline (Spec §15). Values are the `VISION_PIPELINE` / eval `--pipeline` spellings. */
export enum VisionPipelineMode {
  /** Original (downscaled) photo, as before §15. */
  BASELINE = 'baseline',
  /** Perspective-corrected table image. */
  WARP = 'warp',
  /** Perspective correction + locate the row + header/row strip. */
  WARP_STRIP = 'warp-strip',
}
