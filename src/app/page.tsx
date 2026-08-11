import UploadForm from "@/components/pages/UploadForm";
import LoginNudgePopup from "@/components/ui/LoginNudgePopup";

export default function CustomerPage() {
  return (
    <main className="customer-shell">
      <LoginNudgePopup />
      <section className="panel stack">
        <UploadForm />
      </section>
    </main>
  );
}
