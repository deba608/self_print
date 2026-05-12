export type JobStatus =
  | "pending_payment"
  | "paid"
  | "approved"
  | "printing"
  | "printed"
  | "failed"
  | "cancelled";

export type PrintType = "bw" | "color";
export type PaperSize = "A4" | "Legal" | "Photo";
export type FileKind = "pdf" | "image" | "document";

export type Job = {
  id: string;
  token: string;
  status: JobStatus;
  printType: PrintType;
  copies: number;
  pageRange: string | null;
  paperSize: PaperSize;
  pageCount: number;
  pricePaise: number;
  needsConversion: 0 | 1;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  printedAt: string | null;
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
  a4Multiplier: number;
  legalMultiplier: number;
  photoMultiplier: number;
};
