import { describe, expect, it, vi } from 'vitest';

import { OcrLanguage } from '@/domain/enums/OcrLanguage';
import { OcrPageSegMode } from '@/domain/enums/OcrPageSegMode';
import { bindOcrSignal } from '@/server/vision/ocr/AbortableOcr';
import { type OcrProvider } from '@/server/vision/ocr/OcrProvider';
import { readOcrTable } from '@/server/vision/ocr/OcrTableReader';

const REQUEST = {
  image: Buffer.from('png'),
  languages: [OcrLanguage.ENGLISH],
  whitelist: null,
  pageSegMode: OcrPageSegMode.SINGLE_LINE,
};

const fakeOcr = (): OcrProvider & { recognize: ReturnType<typeof vi.fn> } => ({
  recognize: vi.fn(async () => ({ text: 'D', confidence: 90 })),
  terminate: async () => undefined,
});

describe('OCR abort signal', () => {
  it('passes the signal with every job and rejects calls after the abort', async () => {
    const ocr = fakeOcr();
    const controller = new AbortController();
    const bound = bindOcrSignal(ocr, controller.signal);

    await bound.recognize(REQUEST);

    expect(ocr.recognize).toHaveBeenCalledWith({ ...REQUEST, signal: controller.signal });

    controller.abort(new Error('timed out'));

    await expect(bound.recognize(REQUEST)).rejects.toThrow('timed out');
    expect(ocr.recognize).toHaveBeenCalledTimes(1);
  });

  it('leaves the provider untouched without a signal', () => {
    const ocr = fakeOcr();

    expect(bindOcrSignal(ocr, undefined)).toBe(ocr);
  });

  it('stops the table reader before any work once aborted', async () => {
    const ocr = fakeOcr();
    const controller = new AbortController();
    const width = 400;
    const height = 300;
    const source = { width, height, data: Buffer.alloc(width * height * 3, 255) };

    controller.abort(new Error('timed out'));

    await expect(readOcrTable(source, ocr, controller.signal)).rejects.toThrow('timed out');
    // Without a signal the same blank photo is simply "no table".
    await expect(readOcrTable(source, ocr)).resolves.toMatchObject({ ok: false });
    expect(ocr.recognize).not.toHaveBeenCalled();
  });
});
