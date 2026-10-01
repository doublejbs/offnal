import { getAppConfig } from '@/server/config/AppConfig';
import { apiRoute, type TeamParams } from '@/server/http/ApiRoute';
import { jsonResponse } from '@/server/http/RouteHelpers';
import { readUploadedForm } from '@/server/http/UploadForm';
import { listTeamRosters } from '@/server/services/TeamRosterQueries';
import { uploadRoster } from '@/server/services/TeamRosterUploadService';

export const runtime = 'nodejs';

const readTextField = (form: FormData, name: string): string | null => {
  const value = form.get(name);

  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
};

/** TeamRosterListResponse (ADMIN). */
export const GET = apiRoute<TeamParams>({ mutating: false }, async ({ db, context, params }) =>
  listTeamRosters(db, context, params.id),
);

/**
 * multipart `file`, `authorityConfirmed=true`, optional `yearMonth` → 201 CreateTeamRosterResponse (ADMIN).
 */
export const POST = apiRoute<TeamParams>({ mutating: true }, async ({ request, db, context, params }) => {
  const { bytes, form } = await readUploadedForm(request, getAppConfig().uploadMaxBytes);
  const created = await uploadRoster(db, context, params.id, {
    bytes,
    yearMonth: readTextField(form, 'yearMonth'),
    authorityConfirmed: readTextField(form, 'authorityConfirmed') === 'true',
  });

  return jsonResponse(created, 201);
});
