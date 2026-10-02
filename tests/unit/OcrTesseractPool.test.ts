import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OcrLanguage } from '@/domain/enums/OcrLanguage';
import { OcrPageSegMode } from '@/domain/enums/OcrPageSegMode';
import { createTesseractOcrProvider } from '@/server/vision/ocr/TesseractOcrProvider';

const { createWorkerMock } = vi.hoisted(() => ({ createWorkerMock: vi.fn() }));

vi.mock('tesseract.js', () => ({ createWorker: createWorkerMock, OEM: { LSTM_ONLY: 1 } }));

const fakeWorker = () => ({
  terminate: vi.fn(async () => undefined),
  setParameters: vi.fn(async () => undefined),
  recognize: vi.fn(async () => ({ data: { text: ' D ', confidence: 91 } })),
});

const REQUEST = {
  image: Buffer.from('png'),
  languages: [OcrLanguage.ENGLISH],
  whitelist: null,
  pageSegMode: OcrPageSegMode.SINGLE_LINE,
};

describe('tesseract worker pool', () => {
  let cacheDir = '';

  beforeEach(async () => {
    cacheDir = await mkdtemp(path.join(tmpdir(), 'offnal-ocr-'));
    createWorkerMock.mockReset();
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('terminates the workers that started when one fails, then retries on the next call', async () => {
    const started = fakeWorker();

    createWorkerMock.mockResolvedValueOnce(started).mockRejectedValueOnce(new Error('wasm load failed'));

    const ocr = createTesseractOcrProvider({ cacheDir, poolSize: 2 });

    await expect(ocr.recognize(REQUEST)).rejects.toThrow('wasm load failed');
    expect(started.terminate).toHaveBeenCalledTimes(1);

    const retried = [fakeWorker(), fakeWorker()];

    createWorkerMock.mockResolvedValueOnce(retried[0]).mockResolvedValueOnce(retried[1]);

    await expect(ocr.recognize(REQUEST)).resolves.toEqual({ text: 'D', confidence: 91 });
    expect(createWorkerMock).toHaveBeenCalledTimes(4);

    await ocr.terminate();

    expect(retried[0]!.terminate).toHaveBeenCalledTimes(1);
    expect(retried[1]!.terminate).toHaveBeenCalledTimes(1);
    expect(started.terminate).toHaveBeenCalledTimes(1);
  });

  it('terminates the pools that started even when another pool failed', async () => {
    const english = fakeWorker();

    createWorkerMock.mockResolvedValueOnce(english).mockRejectedValueOnce(new Error('no kor data'));

    const ocr = createTesseractOcrProvider({ cacheDir, poolSize: 1 });

    await ocr.recognize(REQUEST);
    await expect(ocr.recognize({ ...REQUEST, languages: [OcrLanguage.KOREAN] })).rejects.toThrow(
      'no kor data',
    );
    await expect(ocr.terminate()).resolves.toBeUndefined();
    expect(english.terminate).toHaveBeenCalledTimes(1);
  });
});
