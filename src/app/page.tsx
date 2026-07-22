import Link from "next/link";
import UploadForm from "@/components/UploadForm";
import ShopHeader from "@/components/ShopHeader";

export default function CustomerPage() {
  return (
    <main className="customer-shell">
      <ShopHeader />
      <section className="panel stack">
        <div className="intro">
          <h1>Print Your Files</h1>
          <p className="muted">Upload from your phone, get a token, pay at the counter, and collect your print.</p>
          <p className="muted" style={{ fontSize: "0.85em" }}>
            Have an account? <Link href="/customer-login">Log in</Link>
          </p>
        </div>
        <UploadForm />
      </section>
    </main>
  );
}