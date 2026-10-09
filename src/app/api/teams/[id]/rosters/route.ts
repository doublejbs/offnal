import { getAppConfig } from '@/server/config/AppConfig';
import { type TeamParams } from '@/server/http/ApiRoute';
import { jsonResponse } from '@/server/http/RouteHelpers';
import { teamApiRoute } from '@/server/http/TeamApiRoute';
import { readUploadedForm } from '@/server/http/UploadForm';
import { requireTeamAdmin } from '@/server/services/TeamAccess';
import { listTeamRosters } from '@/server/services/TeamRosterQueries';
import { uploadRoster } from '@/server/services/TeamRosterUploadService';

export const runtime = 'nodejs';

const readTextField = (form: FormData, name: string): string | null => {
  const value = form.get(name);

  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
};

/** TeamRosterListResponse (ADMIN). */
export const GET = teamApiRoute<TeamParams>({ mutating: false }, async ({ db, context, params }) =>
  listTeamRosters(db, context, params.id),
);

/**
 * multipart `file`, `authorityConfirmed=true`, optional `yearMonth` → 201 CreateTeamRosterResponse (ADMIN).
 * Admin access is checked before the (large) body is read.
 */
export const POST = teamApiRoute<TeamParams>({ mutating: true }, async ({ request, db, context, params }) => {
  const access = await requireTeamAdmin(db, context, params.id);
  const { bytes, form } = await readUploadedForm(request, getAppConfig().uploadMaxBytes);
  const created = await uploadRoster(db, access, {
    bytes,
    yearMonth: readTextField(form, 'yearMonth'),
    authorityConfirmed: readTextField(form, 'authorityConfirmed') === 'true',
  });

  return jsonResponse(created, 201);
});
