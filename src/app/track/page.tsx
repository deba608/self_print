import TrackOrder from "@/components/TrackOrder";
import UserNavbar from "@/components/UserNavbar";

export default async function TrackPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <main className="customer-shell">
      <UserNavbar />
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
