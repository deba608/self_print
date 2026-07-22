import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export type CustomerJobSummary = {
  id: string;
  token: string;
  status: string;
  printType: string;
  copies: number;
  pageCount: number;
  pricePaise: number;
  createdAt: string;
  paidAt: string | null;
  printedAt: string | null;
};

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // RLS ("customers can view own jobs") already restricts rows to this user,
  // but we add the explicit filter as defense-in-depth.
  const { data, error } = await supabase
    .from("jobs")
    .select("id, token, status, print_type, copies, page_count, price_paise, created_at, paid_at, printed_at")
    .eq("customer_user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Could not load jobs" }, { status: 500 });
  }

  const jobs: CustomerJobSummary[] = (data ?? []).map((row) => ({
    id: String(row.id),
    token: String(row.token),
    status: String(row.status),
    printType: String(row.print_type),
    copies: Number(row.copies),
    pageCount: Number(row.page_count),
    pricePaise: Number(row.price_paise),
    createdAt: String(row.created_at),
    paidAt: row.paid_at ? String(row.paid_at) : null,
    printedAt: row.printed_at ? String(row.printed_at) : null,
  }));

  return NextResponse.json({ jobs });
}
