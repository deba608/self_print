export type JobStatus =
  | "pending_payment"
  | "paid"
  | "approved"
  | "printing"
  | "printed"
  | "failed"
  | "cancelled";

export type PrintType = "bw" | "color";
export type PaperSize = "A3" | "A4" | "A5" | "A6" | "B5" | "Letter" | "Legal" | "Photo";
export type PrintLayout = "portrait" | "landscape";
export type PrintMargins = "default" | "none" | "minimum";
export type PrintScale = "default" | "fit" | "shrink" | "noscale";
export type PrintDuplex = "simplex" | "long-edge" | "short-edge";
export type FileKind = "pdf" | "image" | "document";

export type DeliveryMethod = "pickup" | "delivery";
export type DeliveryStatus = "pending" | "out_for_delivery" | "delivered";

export type Job = {
  id: string;
  token: string;
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
  pageCount: number;
  pricePaise: number;
  needsConversion: 0 | 1;
  queuePosition: number;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  paidVia: "online" | "counter" | null;
  printedAt: string | null;
  expiresAt: string;
  issueReportedAt: string | null;
  issueNote: string | null;
  issueResolvedAt: string | null;
  deliveryMethod: DeliveryMethod;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  deliveryFeePaise: number;
  deliveryStatus: DeliveryStatus | null;
  file?: JobFile;
  fileCount?: number;
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
  expiryMinutes: number;
  deliveryFeePaise: number;
};

export type SseClient = {
  controller: ReadableStreamDefaultController;
};

export type PrinterOption = {
  name: string;
  driverName: string;
  portName: string;
  isDefault: boolean;
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
