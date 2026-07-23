import { Headphones } from "lucide-react";
import UploadForm from "@/components/UploadForm";
import UserNavbar from "@/components/UserNavbar";

export default function CustomerPage() {
  return (
    <main className="customer-home">
      <UserNavbar />

      <section className="customer-hero" aria-labelledby="customer-page-title">
        <h1 id="customer-page-title">Print Documents Easily</h1>
        <p>
          Upload your files, configure print settings, generate a token, pay at
          the counter, and collect your print.
        </p>
      </section>

      <section className="customer-upload-card" aria-label="Create a print job">
        <UploadForm />
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
