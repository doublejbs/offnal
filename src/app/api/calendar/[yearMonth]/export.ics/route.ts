import { NextResponse } from 'next/server';

import { apiRoute, type YearMonthParams } from '@/server/http/ApiRoute';
import { NO_STORE } from '@/server/http/RouteHelpers';
import { exportMonthIcs } from '@/server/services/ExportService';

export const runtime = 'nodejs';

const INCLUDE_OFF_VALUES = new Set(['1', 'true']);

export const GET = apiRoute<YearMonthParams>(
  { mutating: false },
  async ({ request, db, context, params }) => {
    const includeOff = INCLUDE_OFF_VALUES.has(request.nextUrl.searchParams.get('includeOff') ?? '');
    const { fileName, body } = await exportMonthIcs(db, context, params.yearMonth, includeOff);

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': NO_STORE,
      },
    });
  },
);
