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

  // 2. Fetch the file into a Blob with the KNOWN mime type first, same as
  // ManualPrint.tsx. Pointing the iframe straight at the proxy URL let the
  // iframe's `load` event fire as soon as Chrome's PDF viewer *shell* was up
  // — before the document had actually painted — so on a slower shop PC
  // print() would fire against a still-blank/loading preview and either lag
  // or print nothing. A blob with a forced mime type renders synchronously
  // once assigned, so `load` reliably means "content is there".
  const proxyUrl = `/api/uploads/${detail.file.id}?proxy=1`;
  const mime = detail.file.mimeType || "application/octet-stream";
  const isImage = mime.startsWith("image/");

  const fileRes = await fetch(proxyUrl, { credentials: "include" });
  if (!fileRes.ok) return { ok: false, error: `File download failed (${fileRes.status}).` };
  const buf = await fileRes.arrayBuffer();
  const blob = new Blob([buf], { type: mime });
  const blobUrl = URL.createObjectURL(blob);

  // 3. Drop an off-screen (but real-sized) iframe, load the file, fire print on load.
  // A 0x0 iframe can make Chrome skip/defer laying out the PDF viewer entirely,
  // which is the other half of the blank/laggy-print bug — give it real dimensions
  // and push it off-screen instead of collapsing it to nothing.
  return new Promise<Result>((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.top = "-10000px";
    iframe.style.left = "-10000px";
    iframe.style.width = "800px";
    iframe.style.height = "1000px";
    iframe.style.border = "0";

    let done = false;
    const cleanup = () => {
      // keep alive long enough for the print dialog to read the doc
      setTimeout(() => {
        iframe.remove();
        URL.revokeObjectURL(blobUrl);
      }, 60_000);
    };

    iframe.onload = () => {
      if (done) return;
      done = true;
      const win = iframe.contentWindow;
      try {
        if (!win) throw new Error("no frame window");
        win.focus();
        // Chrome's PDF viewer fires the iframe's load event once its shell is up,
        // before the PDF itself has painted. Printing immediately opens the native
        // dialog with its preview pane stuck blank/"Loading preview...". Give it a
        // moment to paint first (matches the fix in ManualPrint.tsx).
        setTimeout(() => win.print(), 500);
        cleanup();
        resolve({ ok: true });
      } catch {
        // Fallback: open the file in a new tab for manual Ctrl+P.
        window.open(blobUrl, "_blank");
        cleanup();
        resolve({ ok: true });
      }
    };

    document.body.appendChild(iframe);

    if (isImage) {
      // Wrap so the image fits the page; same-origin blob URL, no CORS issue.
      iframe.removeAttribute("src");
      iframe.srcdoc = `<!doctype html><html><head><meta charset="utf-8">
        <style>@page{margin:8mm}html,body{margin:0;height:100%}
        img{display:block;max-width:100%;max-height:100vh;margin:0 auto;object-fit:contain}</style>
        </head><body><img src="${blobUrl}"></body></html>`;
    } else {
      iframe.removeAttribute("srcdoc");
      iframe.src = blobUrl;
    }
  });
}
