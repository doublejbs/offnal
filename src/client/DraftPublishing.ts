import { getDraft, publishDraft } from '@/client/ApiClient';
import { DraftStatus } from '@/domain/enums/DraftStatus';

/**
 * Publishes a draft with its current server revision (used after a payment or when the month is
 * already entitled). An already published draft is not published again. Resolves to the month.
 */
export const publishDraftById = async (draftId: string): Promise<string> => {
  const { draft } = await getDraft(draftId);

  if (draft.status === DraftStatus.PUBLISHED) {
    return draft.yearMonth;
  }

  const result = await publishDraft(draftId, draft.revision);

  return result.yearMonth;
};
