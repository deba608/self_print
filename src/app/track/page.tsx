import TrackOrder from "@/components/TrackOrder";
import { Printer } from "lucide-react";
import Link from "next/link";

export default async function TrackPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <main className="customer-shell">
      <header className="shop-header">
        <Link href="/" className="shop-logo">
          <Printer size={28} />
          <span>Self_Print</span>
        </Link>
      </header>
      <section className="panel stack">
        <div className="intro">
          <h1>Track Your Order</h1>
          <p className="muted">Enter your token to see live print status.</p>
        </div>
        <TrackOrder initialToken={token} />
      </section>
    </main>
  );
}
