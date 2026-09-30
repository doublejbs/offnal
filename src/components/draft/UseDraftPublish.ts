'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { editCalendarMonth, getErrorMessage, isApiClientError, publishDraft } from '@/client/ApiClient';
import { type LocalDraft } from '@/client/DraftSaveQueue';
import { type DraftAutosave } from '@/components/draft/UseDraftAutosave';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { MonthAccess } from '@/domain/enums/MonthAccess';
import { RevisionConflictReason } from '@/domain/enums/RevisionConflictReason';
import { type DraftResponse } from '@/domain/types/api/DraftResponse';

const UNSAVED_MESSAGE = '아직 저장되지 않은 수정이 있어요. 저장 상태를 확인한 뒤 다시 눌러 주세요.';
const STALE_BASE_MESSAGE =
  '이 달력이 다른 곳에서 먼저 저장됐어요. 최신 달력을 불러와 다시 수정해 주세요. 지금 초안은 저장되지 않아요.';

type DraftPublishInput = {
  draftId: string;
  autosave: DraftAutosave;
  getLocal: () => LocalDraft | null;
  server: DraftResponse | null;
};

const buildCheckoutHref = (yearMonth: string, draftId: string): string =>
  `/checkout/${yearMonth}?draftId=${encodeURIComponent(draftId)}`;

/**
 * Save → (checkout when the server says payment is required) → publish → calendar. Editing is locked by
 * the caller while `isPublishing`, and the last edit is flushed through the same queue first.
 */
export const useDraftPublish = ({ draftId, autosave, getLocal, server }: DraftPublishInput) => {
  const router = useRouter();
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [isStaleBase, setIsStaleBase] = useState(false);

  const handlePublishError = (error: unknown, yearMonth: string) => {
    if (isApiClientError(error) && error.code === ApiErrorCode.PAYMENT_REQUIRED) {
      router.push(buildCheckoutHref(yearMonth, draftId));

      return;
    }

    setIsPublishing(false);

    if (isApiClientError(error) && error.code === ApiErrorCode.REVISION_CONFLICT) {
      const isStale = error.details?.reason === RevisionConflictReason.STALE_BASE;

      setIsStaleBase(isStale);
      setPublishError(isStale ? STALE_BASE_MESSAGE : '다른 곳에서 수정됐어요. 최신 내용을 불러와 주세요.');

      return;
    }

    setPublishError(getErrorMessage(error));
  };

  const handlePublish = async () => {
    if (!getLocal() || !server || isPublishing) {
      return;
    }

    setIsPublishing(true);
    setPublishError(null);

    const isSaved = await autosave.flush();
    const local = getLocal();

    if (!isSaved || !local) {
      setIsPublishing(false);
      setPublishError(UNSAVED_MESSAGE);

      return;
    }

    if (server.access.monthAccess === MonthAccess.PAYMENT_REQUIRED) {
      router.push(buildCheckoutHref(local.yearMonth, draftId));

      return;
    }

    try {
      const result = await publishDraft(draftId, autosave.getRevision());

      router.push(`/calendar/${result.yearMonth}`);
    } catch (error: unknown) {
      handlePublishError(error, local.yearMonth);
    }
  };

  const handleRestartFromPublished = async () => {
    const local = getLocal();

    if (!local) {
      return;
    }

    try {
      const { draftId: nextId } = await editCalendarMonth(local.yearMonth);

      router.replace(`/drafts/${nextId}`);
    } catch (error: unknown) {
      setPublishError(getErrorMessage(error));
    }
  };

  return { isPublishing, publishError, isStaleBase, handlePublish, handleRestartFromPublished };
};

export type DraftPublish = ReturnType<typeof useDraftPublish>;
