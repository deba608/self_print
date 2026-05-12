import UploadForm from "@/components/UploadForm";
import { Printer } from "lucide-react";

export default function CustomerPage() {
  return (
    <main className="customer-shell">
      <header className="shop-header">
        <div className="shop-logo">
          <Printer size={28} />
          <span>SelfPrint Xerox</span>
        </div>
      </header>
      <section className="panel stack">
        <div className="intro">
          <h1>Print Your Files</h1>
          <p className="muted">Upload from your phone, get a token, pay at the counter, and collect your print.</p>
        </div>
        <UploadForm />
      </section>
    </main>
  );
}