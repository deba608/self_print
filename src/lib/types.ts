import type { ServiceAreaConfig } from "./service-area";

export type JobStatus =
  | "pending_payment"
  | "paid"
  | "approved"
  | "printing"
  | "printed"
  | "failed"
  | "cancelled"
  | "expired";

export type PrintType = "bw" | "color";
export type PaperSize = "A3" | "A4" | "A5" | "A6" | "B5" | "Letter" | "Legal" | "Photo";
export type PrintLayout = "portrait" | "landscape";
export type PrintMargins = "default" | "none" | "minimum";
export type PrintScale = "default" | "fit" | "shrink" | "noscale";
export type PrintDuplex = "simplex" | "long-edge" | "short-edge";
export type FileKind = "pdf" | "image" | "document";

export type DeliveryMethod = "pickup" | "delivery";
export type DeliveryStatus = "pending" | "packed" | "picked_up" | "out_for_delivery" | "delivered";

export type StaffRole = "super_admin" | "admin" | "delivery";

export type StaffProfile = {
  id: string;
  email: string;
  displayName: string | null;
  role: StaffRole;
  invitedBy: string | null;
  createdAt: string;
};

export type CustomerProfile = {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  phone: string;
  createdAt: string;
};

export type Job = {
  id: string;
  token: string;
  customerUserId: string | null;
  status: JobStatus;
  printType: PrintType;
  copies: number;
  pageRange: string | null;
  paperSize: PaperSize;
  layout: PrintLayout;
  pagesPerSheet: number;
  margins: PrintMargins;
  scale: PrintScale;
  duplex: PrintDuplex;
  hasSpiralBinding: boolean;
  hasCoverFile: boolean;
  hasBondPaper: boolean;
  spiralBindingQty: number;
  coverFileQty: number;
  pageCount: number;
  pricePaise: number;
  needsConversion: 0 | 1;
  queuePosition: number;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  paidVia: "online" | "counter" | null;
  razorpayPaymentId: string | null;
  refundStatus: "none" | "processing" | "refunded" | "failed" | null;
  refundedAt: string | null;
  printedAt: string | null;
  expiresAt: string;
  issueReportedAt: string | null;
  issueNote: string | null;
  issueResolvedAt: string | null;
  deliveryMethod: DeliveryMethod;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  deliveryPincode: string | null;
  deliveryArea: string | null;
  deliveryFeePaise: number;
  deliveryStatus: DeliveryStatus | null;
  deliveryLatitude: number | null;
  deliveryLongitude: number | null;
  deliveryAccuracyMeters: number | null;
  deliveryLocationCapturedAt: string | null;
  // Rider who claimed this delivery (set by claim_delivery_job) or, when staff
  // dispatch bypasses the claim flow, the admin who dispatched it — see
  // admin/jobs/[id]/delivery-status. Name is resolved server-side; only
  // Supabase mode has a staff_profiles table to resolve it from.
  deliveryPersonId: string | null;
  deliveryPersonName: string | null;
  customNote: string | null;
  file?: JobFile;
  fileCount?: number;
};

export type CustomerManagementRow = {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  registeredAt: string | null;
  totalOrders: number;
  activeOrders: number;
  deliveryOrders: number;
  deliveredOrders: number;
  totalSpentPaise: number;
  lastOrderAt: string | null;
  latestAddress: string | null;
  // Every order token this customer has placed — lets the customer list be
  // searched by token, not just name/email/phone/address.
  tokens: string[];
};

export type JobFile = {
  id: string;
  jobId: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  fileKind: FileKind;
  storagePath: string;
  createdAt: string;
  // Set once the file's bytes have been deleted for privacy retention (see
  // FILE_RETENTION_DAYS). storagePath is emptied at the same time; the row
  // itself (name/size/kind) is kept forever for order history.
  purgedAt: string | null;
  // Per-file print-settings override for bulk jobs (see
  // docs/bulk-per-file-customization-plan.md). Null/undefined = inherit the
  // job's settings — every non-customized file stays exactly as before.
  settings: FileSettingsOverride | null;
};

// Partial override of the job-level print settings, scoped to one file in a
// bulk job. Missing keys fall back to the job's own value — see
// effectiveFileSettings() in src/lib/pricing.ts, the single place both the
// server and the client resolve "override ?? job default".
export type FileSettingsOverride = {
  printType?: PrintType;
  duplex?: PrintDuplex;
  paperSize?: PaperSize;
  copies?: number;
  pagesPerSheet?: number;
};

export type PricingConfig = {
  bwPerPagePaise: number;
  colorPerPagePaise: number;
  photoPrintPaise: number;
  copyMultiplier: number;
  a3Multiplier: number;
  a4Multiplier: number;
  a5Multiplier: number;
  a6Multiplier: number;
  b5Multiplier: number;
  legalMultiplier: number;
  photoMultiplier: number;
  duplexBwPerPagePaise: number;
  spiralBindingPerPagePaise: number;
  coverFilePaise: number;
  bondPaperPerPagePaise: number;
  spiralBindingSlab1Paise: number;
  spiralBindingSlab2Paise: number;
  spiralBindingSlab3Paise: number;
  spiralBindingSlab4Paise: number;
  spiralBindingSlab5Paise: number;
  expiryMinutes: number;
  deliveryFeePaise: number;
  // Delivery fee is waived once printAndAddonPaise reaches this. 0 disables
  // the free-delivery threshold entirely (fee always charged).
  freeDeliveryThresholdPaise: number;
  serviceArea: ServiceAreaConfig;
  // Order-acceptance window, staff-controlled from the Pricing panel.
  // acceptingOrders is a manual kill switch (independent of the time window);
  // when either open/close time is null, the time window is not enforced.
  acceptingOrders: boolean;
  // Shop pickup hours. A second window (orderOpenTime2/orderCloseTime2)
  // covers a split schedule, e.g. 9am-1pm + 4:30-8:30pm with a lunch
  // break between — leave both null to skip the second window.
  orderOpenTime: string | null; // "HH:MM", 24h, shop-local time
  orderCloseTime: string | null;
  orderOpenTime2: string | null;
  orderCloseTime2: string | null;
  orderDays: string | null; // comma-separated ISO weekdays, "1"=Mon..."7"=Sun; null = every day
  // Home delivery window, separate from pickup — narrower hours and
  // restricted to certain days (e.g. no Sunday delivery riders).
  deliveryOpenTime: string | null;
  deliveryCloseTime: string | null;
  deliveryDays: string | null;
};

export type RetentionConfig = {
  cartAbandonMinutes: number;
  fileRetentionDays: number;
  strayFileRetentionHours: number;
  loginEventRetentionDays: number;
};

export type PrinterOption = {
  name: string;
  driverName: string;
  portName: string;
  isDefault: boolean;
  canDuplex: boolean;
  seenAt: string;
};

export type DailyJobSummary = {
  date: string;              // "YYYY-MM-DD"
  totalJobs: number;
  totalRevenuePaise: number;
  confirmedRevenuePaise: number; // paid + printed only
  bwJobs: number;
  colorJobs: number;
  photoJobs: number;
  pagesTotal: number;
  printedJobs: number;
  cancelledJobs: number;
  pendingJobs: number;
};

export type AccountsSummary = {
  totalRevenuePaise: number;
  confirmedRevenuePaise: number;
  pendingRevenuePaise: number;
  totalJobs: number;
  printedJobs: number;
  totalPages: number;
  bwJobs: number;
  colorJobs: number;
  photoJobs: number;
};

export type ParsedUA = {
  browser: string;
  os: string;
  device: string;
};

export type LoginEvent = {
  id: string;
  staffId: string | null;
  email: string;
  ip: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  city: string | null;
  country: string | null;
  success: boolean;
  failureReason: string | null;
  loggedAt: string;
};
