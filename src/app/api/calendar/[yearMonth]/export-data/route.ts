import { apiRoute, type YearMonthParams } from '@/server/http/ApiRoute';
import { getExportData } from '@/server/services/ExportService';

export const runtime = 'nodejs';

export const GET = apiRoute<YearMonthParams>({ mutating: false }, async ({ db, context, params }) =>
  getExportData(db, context, params.yearMonth),
);
