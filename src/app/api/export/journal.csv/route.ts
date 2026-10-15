import { journalLines, toCsv } from "@/lib/journal";

export const dynamic = "force-dynamic";

/** GET /api/export/journal.csv — journal lines for the accountant (Xero/MYOB import is out of scope). */
export async function GET() {
  const csv = toCsv(await journalLines());
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="kindcollect-journal.csv"',
    },
  });
}
