import { apiRoute, type YearMonthParams } from '@/server/http/ApiRoute';
import { icsResponse, parseIcsDisposition, parseIncludeOff } from '@/server/http/RouteHelpers';
import { exportMonthIcs } from '@/server/services/ExportService';

export const runtime = 'nodejs';

export const GET = apiRoute<YearMonthParams>(
  { mutating: false },
  async ({ request, db, context, params }) => {
    const { searchParams } = request.nextUrl;
    const includeOff = parseIncludeOff(searchParams);
    const { fileName, body } = await exportMonthIcs(db, context, params.yearMonth, includeOff);

    return icsResponse(fileName, body, parseIcsDisposition(searchParams));
  },
);
