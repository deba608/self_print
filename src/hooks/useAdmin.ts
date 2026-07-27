import useSWR, { type SWRConfiguration } from "swr";
import type {
  Job,
  PricingConfig,
  PrinterOption,
  CustomerManagementRow,
  StaffProfile,
  LoginEvent,
} from "@/lib/types";

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((res) => {
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  });

// ─── Jobs (paginated) ──────────────────────────────────────────────

export type JobsResponse = {
  jobs: Job[];
  cursor: string | null;
  limit: number;
  total: number;
  expiryMinutes: number;
};

export function useJobs(opts?: SWRConfiguration<JobsResponse>) {
  return useSWR<JobsResponse>("/api/admin/jobs", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 2000,
    ...opts,
  });
}

// ─── Summary (active jobs + revenue) ────────────────────────────────

export type SummaryResponse = { jobs: number; totalPaise: number };

export function useSummary(opts?: SWRConfiguration<SummaryResponse>) {
  return useSWR<SummaryResponse>("/api/admin/summary", fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 30000,
    ...opts,
  });
}

// ─── Pricing config ────────────────────────────────────────────────

export function usePricing(opts?: SWRConfiguration<PricingConfig>) {
  return useSWR<PricingConfig>("/api/admin/pricing", fetcher, {
    revalidateOnFocus: false,
    ...opts,
  });
}

// ─── Selected printer ──────────────────────────────────────────────

export type PrinterConfigResponse = { printerName: string; configVersion: number };

export function usePrinter(opts?: SWRConfiguration<PrinterConfigResponse>) {
  return useSWR<PrinterConfigResponse>("/api/admin/printer", fetcher, {
    revalidateOnFocus: false,
    ...opts,
  });
}

// ─── Available printers (from agent) ───────────────────────────────

export type PrintersResponse = { printers: PrinterOption[] };

export function usePrinters(opts?: SWRConfiguration<PrintersResponse>) {
  return useSWR<PrintersResponse>("/api/admin/printers", fetcher, {
    refreshInterval: 10000,
    revalidateOnFocus: false,
    ...opts,
  });
}

// ─── Customers ─────────────────────────────────────────────────────

export type CustomersResponse = { customers: CustomerManagementRow[] };

export function useCustomers(opts?: SWRConfiguration<CustomersResponse>) {
  return useSWR<CustomersResponse>("/api/admin/customers", fetcher, {
    revalidateOnFocus: false,
    ...opts,
  });
}

// ─── Staff list ────────────────────────────────────────────────────

export type StaffResponse = { staff: StaffProfile[] };

export function useStaff(opts?: SWRConfiguration<StaffResponse>) {
  return useSWR<StaffResponse>("/api/admin/staff", fetcher, {
    revalidateOnFocus: false,
    ...opts,
  });
}

// ─── Login events (security audit) ─────────────────────────────────

export type LoginEventsResponse = { events: LoginEvent[] };

export function useLoginEvents(
  staffId?: string,
  opts?: SWRConfiguration<LoginEventsResponse>
) {
  const url = staffId
    ? `/api/admin/login-events?staffId=${encodeURIComponent(staffId)}`
    : "/api/admin/login-events";
  return useSWR<LoginEventsResponse>(url, fetcher, {
    revalidateOnFocus: false,
    ...opts,
  });
}

// ─── Current staff session ─────────────────────────────────────────

export function useCurrentStaff(opts?: SWRConfiguration<StaffProfile>) {
  return useSWR<StaffProfile>("/api/admin/me", fetcher, {
    revalidateOnFocus: false,
    ...opts,
  });
}
