/** One provider call of the second-pass pipeline. */
export enum VisionPipelineStep {
  EXTRACT = 'extract',
  LOCATE_ROW = 'locate-row',
  EXTRACT_STRIP = 'extract-strip',
}
