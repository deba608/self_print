"use client";
import PdfViewer from "@/components/pdf/PdfViewer";

export default function TestPage() {
  return (
    <div style={{ height: "100vh" }}>
      <PdfViewer fileUrl="/__pdfv_test.pdf" fileName="selfprint-shop-qr-a4.pdf" />
    </div>
  );
}
