import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OcrLanguage } from '@/domain/enums/OcrLanguage';
import { OcrPageSegMode } from '@/domain/enums/OcrPageSegMode';
import { OcrShadowErrorKind } from '@/domain/enums/OcrShadowErrorKind';
import { OcrEngineError } from '@/server/vision/ocr/OcrEngineError';
import { resolveOcrLanguageFile } from '@/server/vision/ocr/OcrLanguageData';
import { createTesseractOcrProvider } from '@/server/vision/ocr/TesseractOcrProvider';

const { createWorkerMock } = vi.hoisted(() => ({ createWorkerMock: vi.fn() }));

vi.mock('tesseract.js', () => ({ createWorker: createWorkerMock, OEM: { LSTM_ONLY: 1 } }));

const fakeWorker = () => ({
  worker: new EventEmitter(),
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

const engineError = (kind: OcrShadowErrorKind) => expect.objectContaining({ name: 'OcrEngineError', kind });

describe('tesseract worker pool', () => {
  beforeEach(() => {
    createWorkerMock.mockReset();
  });

  it('reads the bundled language data without cache writes or downloads', async () => {
    const worker = fakeWorker();

    createWorkerMock.mockResolvedValueOnce(worker);

    const ocr = createTesseractOcrProvider({ poolSize: 1 });

    await ocr.recognize(REQUEST);

    const [, , options] = createWorkerMock.mock.calls[0]!;

    expect(options).toMatchObject({
      langPath: path.dirname(resolveOcrLanguageFile(OcrLanguage.ENGLISH)),
      cacheMethod: 'none',
      errorHandler: expect.any(Function),
    });
    expect(options).not.toHaveProperty('cachePath');
    await ocr.terminate();
  });

  it('classifies missing language data as a download failure without starting workers', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'offnal-ocr-'));

    try {
      const ocr = createTesseractOcrProvider({ dataRoot: root, poolSize: 1 });

      await expect(ocr.recognize(REQUEST)).rejects.toEqual(engineError(OcrShadowErrorKind.DOWNLOAD));
      expect(createWorkerMock).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('terminates the workers that started when one fails, then retries on the next call', async () => {
    const started = fakeWorker();

    createWorkerMock.mockResolvedValueOnce(started).mockRejectedValueOnce('wasm load failed');

    const ocr = createTesseractOcrProvider({ poolSize: 2 });

    await expect(ocr.recognize(REQUEST)).rejects.toEqual(engineError(OcrShadowErrorKind.WORKER_INIT));
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

    createWorkerMock.mockResolvedValueOnce(english).mockRejectedValueOnce('no kor data');

    const ocr = createTesseractOcrProvider({ poolSize: 1 });

    await ocr.recognize(REQUEST);
    await expect(ocr.recognize({ ...REQUEST, languages: [OcrLanguage.KOREAN] })).rejects.toEqual(
      engineError(OcrShadowErrorKind.WORKER_INIT),
    );
    await expect(ocr.terminate()).resolves.toBeUndefined();
    expect(english.terminate).toHaveBeenCalledTimes(1);
  });

  it('rejects every call after terminate() and never starts a worker again', async () => {
    createWorkerMock.mockImplementation(async () => fakeWorker());

    const ocr = createTesseractOcrProvider({ poolSize: 1 });

    await ocr.recognize(REQUEST);
    await ocr.terminate();

    const calls = createWorkerMock.mock.calls.length;

    await expect(ocr.recognize(REQUEST)).rejects.toBeInstanceOf(OcrEngineError);
    await expect(ocr.recognize({ ...REQUEST, languages: [OcrLanguage.KOREAN] })).rejects.toEqual(
      engineError(OcrShadowErrorKind.RECOGNIZE),
    );
    expect(createWorkerMock).toHaveBeenCalledTimes(calls);
  });

  it('terminates a pool that finished starting after terminate() and rejects its caller', async () => {
    const late = fakeWorker();
    let release: (worker: ReturnType<typeof fakeWorker>) => void = () => undefined;

    createWorkerMock.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));

    const ocr = createTesseractOcrProvider({ poolSize: 1 });
    const pending = ocr.recognize(REQUEST);

    await vi.waitFor(() => expect(createWorkerMock).toHaveBeenCalledTimes(1));

    const terminating = ocr.terminate();

    release(late);

    await expect(pending).rejects.toBeInstanceOf(OcrEngineError);
    await terminating;
    expect(late.terminate).toHaveBeenCalled();
    expect(late.recognize).not.toHaveBeenCalled();
  });

  it('skips queued jobs once their signal is aborted', async () => {
    const worker = fakeWorker();
    const controller = new AbortController();
    let finishFirst: () => void = () => undefined;

    worker.recognize.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = () => resolve({ data: { text: 'E', confidence: 80 } });
        }),
    );
    createWorkerMock.mockResolvedValueOnce(worker);

    const ocr = createTesseractOcrProvider({ poolSize: 1 });
    const first = ocr.recognize(REQUEST);
    const queued = ocr.recognize({ ...REQUEST, signal: controller.signal });

    await vi.waitFor(() => expect(worker.recognize).toHaveBeenCalledTimes(1));
    controller.abort(new Error('budget'));
    finishFirst();

    await expect(first).resolves.toEqual({ text: 'E', confidence: 80 });
    await expect(queued).rejects.toThrow('budget');
    expect(worker.recognize).toHaveBeenCalledTimes(1);
    await ocr.terminate();
  });

  it('fails waiting jobs and later calls when a worker thread crashes', async () => {
    const worker = fakeWorker();

    worker.recognize.mockImplementationOnce(() => new Promise(() => undefined));
    createWorkerMock.mockResolvedValueOnce(worker);

    const ocr = createTesseractOcrProvider({ poolSize: 1 });
    const hanging = ocr.recognize(REQUEST);

    await vi.waitFor(() => expect(worker.recognize).toHaveBeenCalledTimes(1));
    worker.worker.emit('error', new Error('worker out of memory'));

    await expect(hanging).rejects.toEqual(engineError(OcrShadowErrorKind.RECOGNIZE));
    await expect(ocr.recognize(REQUEST)).rejects.toEqual(engineError(OcrShadowErrorKind.RECOGNIZE));
    await ocr.terminate();
  });
});
