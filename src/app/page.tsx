import UploadForm from "@/components/UploadForm";

export default function CustomerPage() {
  return (
    <main className="customer-home">
      <section className="customer-hero" aria-labelledby="customer-page-title">
        <h1 id="customer-page-title">Print Documents Easily</h1>
        <p>
          Upload one or more PDFs, choose pickup or delivery, and track every
          step from printing to fulfilment.
        </p>
      </section>

      <section className="customer-upload-card" aria-label="Create a print job">
        <UploadForm />
      </section>

      <aside className="customer-help">
        <div>
          <h2>Need assistance?</h2>
          <p>Our staff will help you print your documents quickly.</p>
        </div>
      </aside>
    </main>
  );
}
