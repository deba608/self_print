import TrackOrder from "@/components/pages/TrackOrder";

export default async function TrackPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <main className="customer-shell">
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
