// Fast client-side page-count estimate: counts "/Type /Page" object markers
// in the raw bytes. Not a real PDF parse — linearized/compressed object
// streams can hide markers — but right for the overwhelming majority of
// uploads, and the server recounts authoritatively anyway.
//
// Scans in chunks instead of decoding the whole file at once: a 25MB upload
// decoded to a single latin1 string froze the main thread for seconds on
// mid-range phones (and briefly doubled memory). Each chunk decode is a few
// ms, and the awaited slice reads yield to the event loop between chunks.

const PAGE_MARKER = /\/Type\s*\/Page\b/g;

// Overlap carried between chunks so a marker spanning a boundary is still
// seen whole. 256 bytes covers "/Type" + any sane whitespace run + "/Page".
const OVERLAP = 256;

// A match ending within the last few chars of a non-final chunk is not
// trustworthy: the \b in PAGE_MARKER matches end-of-string, so "/Type /Page"
// split right before the "s" of "/Pages" would count. Matches ending in this
// zone are deferred to the next iteration, where the overlap tail shows them
// with their following context. Must stay smaller than OVERLAP.
const DEFER = 8;

export async function estimatePdfPages(
  file: File,
  chunkSize = 2 * 1024 * 1024
): Promise<number> {
  try {
    const decoder = new TextDecoder("latin1");
    let count = 0;
    let tail = "";
    // Absolute byte position up to which matches have been finalized —
    // latin1 is one char per byte, so string indices map 1:1 to bytes.
    let finalizedAbs = 0;

    for (let offset = 0; offset < file.size; offset += chunkSize) {
      const bytes = await file.slice(offset, offset + chunkSize).arrayBuffer();
      const text = tail + decoder.decode(bytes);
      const textStartAbs = offset - tail.length;
      const isLastChunk = offset + chunkSize >= file.size;
      const finalEndAbs = textStartAbs + text.length - (isLastChunk ? 0 : DEFER);

      PAGE_MARKER.lastIndex = 0;
      for (let m = PAGE_MARKER.exec(text); m; m = PAGE_MARKER.exec(text)) {
        const absEnd = textStartAbs + m.index + m[0].length;
        if (absEnd > finalizedAbs && absEnd <= finalEndAbs) count++;
      }

      finalizedAbs = finalEndAbs;
      tail = text.slice(Math.max(0, text.length - OVERLAP));
    }

    return Math.max(count, 1);
  } catch {
    return 1;
  }
}
