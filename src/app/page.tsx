import UploadForm from "@/components/UploadForm";

export default function CustomerPage() {
  return (
    <main className="customer-shell">
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
