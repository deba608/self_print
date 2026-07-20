// Client-side manual/backup print: loads a job's file into a hidden, same-origin
// iframe and triggers the native Windows/browser print dialog directly — no
// agent, no page navigation. Used by the "Manual Print" buttons in the admin UI.

type Result = { ok: true } | { ok: false; error: string };

export async function manualPrint(jobId: string): Promise<Result> {
  // 1. Load job detail to find the file + its mime type.
  const detailRes = await fetch(`/api/admin/jobs/${jobId}`, { credentials: "include" });
  if (!detailRes.ok) {
    return { ok: false, error: detailRes.status === 401 ? "Please log in to the admin first." : "Could not load job." };
  }
  const detail = await detailRes.json();

  if (detail.job?.needsConversion === 1) {
    return { ok: false, error: "Convert this DOC/DOCX to PDF before printing." };
  }
  if (!detail.file) {
    return { ok: false, error: "No file is attached to this job." };
  }

  // 2. Point straight at the same-origin proxy — the server already sets the
  // correct Content-Type, so the iframe can stream/render it directly. No
  // need to fetch() the whole file into a Blob client-side first; that just
  // adds a full extra download-then-rebuild round trip before printing can
  // even start.
  const proxyUrl = `/api/uploads/${detail.file.id}?proxy=1`;
  const mime = detail.file.mimeType || "application/octet-stream";
  const isImage = mime.startsWith("image/");

  // 3. Drop a hidden iframe, load the file, fire print on load.
  return new Promise<Result>((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";

    let done = false;
    const cleanup = () => {
      setTimeout(() => iframe.remove(), 60_000); // keep alive long enough for the print dialog to read the doc
    };

    iframe.onload = () => {
      if (done) return;
      done = true;
      const win = iframe.contentWindow;
      try {
        if (!win) throw new Error("no frame window");
        win.focus();
        win.print();
        cleanup();
        resolve({ ok: true });
      } catch {
        // Fallback: open the file in a new tab for manual Ctrl+P.
        window.open(proxyUrl, "_blank");
        cleanup();
        resolve({ ok: true });
      }
    };

    document.body.appendChild(iframe);

    if (isImage) {
      // Wrap so the image fits the page; same-origin proxy URL, no CORS issue.
      iframe.srcdoc = `<!doctype html><html><head><meta charset="utf-8">
        <style>@page{margin:8mm}html,body{margin:0;height:100%}
        img{display:block;max-width:100%;max-height:100vh;margin:0 auto;object-fit:contain}</style>
        </head><body><img src="${proxyUrl}"></body></html>`;
    } else {
      iframe.src = proxyUrl;
    }
  });
}
