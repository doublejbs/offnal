import 'server-only';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { isTeamComingSoon } from '@/domain/TeamPolicy';
import { type AppConfig, getAppConfig } from '@/server/config/AppConfig';
import { ApiError } from '@/server/errors/ApiError';

/**
 * Team "준비 중" mode (Spec §24.2): every team and invite API is 404. Called before the origin check, the
 * session, the DB and the body, so nothing team-related is read or written.
 */
export const assertTeamsEnabled = (config: Pick<AppConfig, 'teamMode'> = getAppConfig()): void => {
  if (isTeamComingSoon(config)) {
    throw new ApiError(ApiErrorCode.NOT_FOUND);
  }
};
