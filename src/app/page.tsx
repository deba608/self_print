import UploadForm from "@/components/UploadForm";

export default function CustomerPage() {
  return (
    <main className="customer-home">
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


    </main>
  );
}
