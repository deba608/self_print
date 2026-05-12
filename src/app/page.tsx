import UploadForm from "@/components/UploadForm";

export default function CustomerPage() {
  return (
    <main className="customer-shell">
      <section className="panel stack">
        <div>
          <h1>SelfPrint Xerox</h1>
          <p className="muted">Upload from your phone, get a token, pay at the counter, and collect your print.</p>
        </div>
        <UploadForm />
      </section>
    </main>
  );
}
