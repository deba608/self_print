import { Printer } from "lucide-react";

export default function EmptyState({ message }: { message: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Printer size={48} strokeWidth={1} />
      </div>
      <h3>No jobs found</h3>
      <p>{message}</p>
    </div>
  );
}
