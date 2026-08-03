"use client";

import { Eye } from "lucide-react";

// Sits inside the job card's <Link> (whole card navigates to /track). Stops
// the click from bubbling to the parent Link so it can open the file in its
// own tab instead of navigating away.
export default function JobFileViewButton({ fileId }: { fileId: string }) {
  return (
    <button
      type="button"
      className="jobs-file-view-btn"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        window.open(`/api/user/files/${fileId}`, "_blank", "noopener,noreferrer");
      }}
    >
      <Eye size={13} aria-hidden="true" /> View
    </button>
  );
}
