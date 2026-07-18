import { NextRequest, NextResponse } from "next/server";
import { requireAdminResponse } from "@/lib/security";
import { getDailyAnalytics, getAccountsSummary } from "@/lib/db";

export async function GET(request: NextRequest) {
  const authError = await requireAdminResponse();
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  const rawFrom = searchParams.get("from");
  const rawTo   = searchParams.get("to");

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const from = rawFrom && dateRe.test(rawFrom) ? rawFrom : (() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return d.toISOString().slice(0, 10);
  })();
  const to = rawTo && dateRe.test(rawTo) ? rawTo : today;

  try {
    const [days, todaySummary] = await Promise.all([
      getDailyAnalytics(from, to),
      getAccountsSummary(today),
    ]);

    const summary = {
      totalRevenuePaise:     days.reduce((s, d) => s + d.totalRevenuePaise, 0),
      confirmedRevenuePaise: days.reduce((s, d) => s + d.confirmedRevenuePaise, 0),
      totalJobs:             days.reduce((s, d) => s + d.totalJobs, 0),
      totalPages:            days.reduce((s, d) => s + d.pagesTotal, 0),
      bwJobs:                days.reduce((s, d) => s + d.bwJobs, 0),
      colorJobs:             days.reduce((s, d) => s + d.colorJobs, 0),
      photoJobs:             days.reduce((s, d) => s + d.photoJobs, 0),
    };

    return NextResponse.json({ days, summary, today: todaySummary });
  } catch (error) {
    console.error("[analytics/daily]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analytics query failed" },
      { status: 500 }
    );
  }
}
