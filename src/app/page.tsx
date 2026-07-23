import { Clock3, Headphones, ShieldCheck } from "lucide-react";
import UploadForm from "@/components/UploadForm";

export default function CustomerPage() {
  return (
    <main className="customer-home">
      <section className="customer-hero" aria-labelledby="customer-page-title">
        <span className="customer-eyebrow">Simple, secure document printing</span>
        <h1 id="customer-page-title">Print Documents Easily</h1>
        <p>
          Upload your files, configure print settings, generate a token, pay at
          the counter, and collect your print.
        </p>
      </section>

      <section className="customer-upload-card" aria-label="Create a print job">
        <UploadForm />
      </section>

      <section className="customer-assurance" aria-label="Service benefits">
        <div>
          <ShieldCheck size={18} aria-hidden="true" />
          <span>Secure upload</span>
        </div>
        <div>
          <Clock3 size={18} aria-hidden="true" />
          <span>Quick setup</span>
        </div>
        <div>
          <Headphones size={18} aria-hidden="true" />
          <span>Staff assistance</span>
        </div>
      </section>

      <aside className="customer-help">
        <Headphones size={22} aria-hidden="true" />
        <div>
          <h2>Need assistance?</h2>
          <p>Our staff will help you print your documents quickly.</p>
        </div>
      </aside>
    </main>
  );
}
