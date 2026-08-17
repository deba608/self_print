// Layout rules shared between the on-screen print preview and the Windows
// print agent. Keep these in lockstep with agent/print-image.ps1 — a preview
// that disagrees with the agent is worse than no preview at all.

/**
 * Should a page be rotated 90° so it fills its cell?
 *
 * Mirrors the auto-rotate block in `agent/print-image.ps1`:
 *
 *   if ($Scale -ne "noscale" -and $sheetFiles.Count -eq 1) {
 *     $imgLandscape = $img.Width -gt $img.Height
 *     $cellLandscape = $cellW -gt $cellH
 *     if ($imgLandscape -ne $cellLandscape) { rotate 90 }
 *   }
 *
 * Both guards matter. The agent only rotates when the page is alone on the
 * sheet and scaling is permitted, so an N-up or "noscale" job prints upright.
 * The preview previously rotated unconditionally, which is why some pages
 * appeared sideways on screen but came out of the printer the right way up.
 *
 * Note the agent rotates on any orientation mismatch — there is no "only if it
 * fits better" test — so this must not add one either.
 */
export function shouldAutoRotate({
  pagesPerSheet,
  scaleMode,
  pageW,
  pageH,
  cellW,
  cellH,
}: {
  pagesPerSheet: number;
  scaleMode: string;
  pageW: number;
  pageH: number;
  cellW: number;
  cellH: number;
}): boolean {
  if (pagesPerSheet !== 1 || scaleMode === "noscale") return false;
  // `>` (not `>=`) matches PowerShell's -gt, so a square page counts as
  // portrait on both sides of the comparison.
  return pageW > pageH !== cellW > cellH;
}
