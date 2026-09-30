import { apiRoute, type YearMonthParams } from '@/server/http/ApiRoute';
import { icsResponse, parseIncludeOff } from '@/server/http/RouteHelpers';
import { exportMonthIcs } from '@/server/services/ExportService';

export const runtime = 'nodejs';

export const GET = apiRoute<YearMonthParams>(
  { mutating: false },
  async ({ request, db, context, params }) => {
    const includeOff = parseIncludeOff(request.nextUrl.searchParams);
    const { fileName, body } = await exportMonthIcs(db, context, params.yearMonth, includeOff);

    return icsResponse(fileName, body);
  },
);
