param(
  [Parameter(Mandatory=$true)][string]$Printer,
  [Parameter(Mandatory=$true)][string]$FileList,  # newline-separated image paths, in page order
  [int]$Copies = 1,
  [string]$Color = "true",
  [string]$Landscape = "false",
  [string]$PaperName = "A4",
  [string]$Scale = "default",         # default | fit | shrink | noscale
  [string]$Margins = "default",       # default | none | minimum
  [int]$PagesPerSheet = 1,
  [string]$Duplex = "simplex",        # simplex | long-edge | short-edge
  [string]$Collate = "true",          # true | false — collate multi-copy output
  [int]$RenderDpi = 216               # DPI the agent rasterised PDF pages at
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$files = @( (Get-Content -LiteralPath $FileList) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } )
if (-not $files -or $files.Count -eq 0) { Write-Error "No image files to print."; exit 3 }

$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = $Printer
if (-not $doc.PrinterSettings.IsValid) { Write-Error "Invalid printer: $Printer"; exit 2 }

# Win32_Printer.DetectedErrorState codes that mean "will not physically print
# right now" — worth failing loudly for so staff fix it (add paper, close
# door, clear jam) instead of the job silently sitting in the spooler.
# 3=Low Paper 4=No Paper 7=Door Open 8=Jammed 9=Offline 10=Service Requested
# 11=Output Bin Full 12=Paper Problem
function Get-PrinterBlockingError([string]$printerName) {
  try {
    $escaped = $printerName -replace "'", "''"
    $wmi = Get-CimInstance -ClassName Win32_Printer -Filter "Name='$escaped'" -ErrorAction Stop
    if (-not $wmi) { return $null }
    $state = [int]$wmi.DetectedErrorState
    $reason = switch ($state) {
      3  { "low on paper" }
      4  { "out of paper" }
      7  { "door/cover open" }
      8  { "paper jam" }
      9  { "offline" }
      10 { "needs service" }
      11 { "output tray full" }
      12 { "has a paper problem" }
      default { $null }
    }
    if ($reason) { return $reason }
    if ($wmi.WorkOffline) { return "offline" }
  } catch {
    # WMI not available / printer not queryable this way (e.g. some network
    # queues) — skip the check rather than block printing on an unknown.
  }
  return $null
}

$blockingError = Get-PrinterBlockingError -printerName $Printer
if ($blockingError) {
  Write-Error "Printer '$Printer' is $blockingError. Fix the printer and retry the job."
  exit 5
}

if ($Copies -lt 1) { $Copies = 1 }
$doc.PrinterSettings.Copies = [int16]$Copies
$doc.PrinterSettings.Collate = ($Collate -eq "true")
$doc.DefaultPageSettings.Landscape = ($Landscape -eq "true")
$doc.DefaultPageSettings.Color = ($Color -eq "true")

# Margins are applied inside the PrintPage handler (see below). .NET's
# DefaultPageSettings.Margins defaults to a hardcoded 1 inch on every side —
# NOT the driver's default — so fitting into $e.MarginBounds shrank output to
# ~76% of the page. The handler instead computes the target area from the
# physical page size, using the printer's hardware margins for "default".

# Match requested paper size if the driver offers it.
$ps = $doc.PrinterSettings.PaperSizes | Where-Object { $_.PaperName -like "*$PaperName*" } | Select-Object -First 1
if ($ps) { $doc.DefaultPageSettings.PaperSize = $ps }

# Double-sided requested. CanDuplex is only advisory here: host-based/GDI
# drivers (e.g. KONICA MINOLTA 205i) report $false even though the hardware
# duplexes fine, so never hard-fail on it — set the duplex DEVMODE regardless
# and rely on the Set-PrintConfiguration queue rewrite below, which is the
# path those drivers actually honor.
if ($Duplex -ne "simplex") {
  # Capability warning disabled for now (CanDuplex lies for host-based drivers
  # like KONICA MINOLTA 205i). Re-enable if wanted:
  # if (-not $doc.PrinterSettings.CanDuplex) {
  #   Write-Output "WARN: printer '$Printer' reports no duplex support - attempting double-sided anyway."
  # }
  $doc.PrinterSettings.Duplex = if ($Duplex -eq "short-edge") {
    [System.Drawing.Printing.Duplex]::Horizontal
  } else {
    [System.Drawing.Printing.Duplex]::Vertical
  }
} else {
  $doc.PrinterSettings.Duplex = [System.Drawing.Printing.Duplex]::Simplex
}

# Some host-based/GDI drivers (e.g. KONICA MINOLTA 205i) ignore the per-document
# DEVMODE duplex above and always use the print queue's default preference. Force
# the queue default to match this job via the Windows print-management layer; the
# agent prints jobs one at a time, so mutating the queue default is safe. Failure
# is non-fatal — drivers that honor DEVMODE don't need it.
$queueDuplex = switch ($Duplex) {
  "short-edge" { "TwoSidedShortEdge" }
  "long-edge"  { "TwoSidedLongEdge" }
  default      { "OneSided" }
}

# Set-PrintConfiguration rewrites the queue's stored DEVMODE. On host-based drivers
# that ignore per-job DEVMODE (see above), this rewrite is what actually takes effect
# printer-side -- so PaperSize must be included here too, or the queue silently falls
# back to its own default paper (often Letter), printing smaller than the requested A4.
$queuePaperSize = $null
try {
  $queuePaperSize = [Microsoft.PowerShell.Cmdletization.GeneratedTypes.PrintConfiguration.PaperSizeEnum]$PaperName
} catch {
  # Unmapped paper name (e.g. driver-specific): skip, let the queue keep its own default.
}
try {
  if ($queuePaperSize) {
    Set-PrintConfiguration -PrinterName $Printer -DuplexingMode $queueDuplex -PaperSize $queuePaperSize -ErrorAction Stop
  } else {
    Set-PrintConfiguration -PrinterName $Printer -DuplexingMode $queueDuplex -ErrorAction Stop
  }
} catch {
  Write-Output ("WARN: could not set queue duplex/paper mode ($queueDuplex, $PaperName): " + $_.Exception.Message)
}

if ($PagesPerSheet -lt 1) { $PagesPerSheet = 1 }

# Group source images into physical sheets of $PagesPerSheet each.
$sheets = New-Object System.Collections.ArrayList
for ($i = 0; $i -lt $files.Count; $i += $PagesPerSheet) {
  $end = [Math]::Min($i + $PagesPerSheet, $files.Count) - 1
  [void]$sheets.Add(@($files[$i..$end]))
}

# $RenderDpi (param) is the DPI the agent's PDF rasteriser rendered at; needed to
# convert pixel dimensions back to real-world inches for "shrink" / "noscale".

# State held in a hashtable captured by closure (.GetNewClosure). Hashtables are
# reference types, so mutating $state.idx inside the event handler is reliable
# across PowerShell versions — unlike $script:-scope writes inside a .NET event
# delegate, which can silently fail to persist and reprint page 1 forever.
$state = @{ idx = 0; sheets = $sheets }

$doc.add_BeginPrint({ $state.idx = 0 }.GetNewClosure())

$doc.add_PrintPage({
  param($printSender, $e)
  $sheetFiles = $state.sheets[$state.idx]

  # GDI puts the Graphics origin at the top-left of the *printable* area (past
  # the hardware margin), not the physical page corner. Shift it back so all
  # coordinates below are in true physical-page space (units: 1/100 inch).
  # HardMarginX/Y are unreliable in landscape on some drivers (they keep
  # portrait values); PrintableArea is documented as always portrait-relative,
  # so derive the offsets from it and swap axes for landscape ourselves.
  $pa = $e.PageSettings.PrintableArea
  if ($e.PageSettings.Landscape) {
    $hardX = $pa.Y
    $hardY = $pa.X
  } else {
    $hardX = $pa.X
    $hardY = $pa.Y
  }
  $e.Graphics.TranslateTransform(-$hardX, -$hardY)

  # PageBounds is orientation-aware physical paper size in 1/100 inch.
  $pageW = $e.PageBounds.Width
  $pageH = $e.PageBounds.Height
  $m = switch ($Margins) {
    "none"    { 0 }
    "minimum" { 25 }
    # "default": hug the printable edge — symmetric margin equal to the larger
    # hardware margin, so content prints as close to full-page as the printer allows.
    default   { [Math]::Ceiling([Math]::Max($hardX, $hardY)) }
  }
  $area = New-Object System.Drawing.Rectangle([int]$m, [int]$m, [int]($pageW - 2 * $m), [int]($pageH - 2 * $m))

  # High-quality resampling — the GDI default (low bilinear) prints scaled
  # images visibly soft/jagged.
  $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $e.Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $e.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

  $cols = [int][Math]::Ceiling([Math]::Sqrt($sheetFiles.Count))
  $rows = [int][Math]::Ceiling($sheetFiles.Count / $cols)
  $cellW = $area.Width / $cols
  $cellH = $area.Height / $rows

  for ($n = 0; $n -lt $sheetFiles.Count; $n++) {
    $img = [System.Drawing.Image]::FromFile($sheetFiles[$n])
    try {
      $col = $n % $cols
      $row = [Math]::Floor($n / $cols)
      $cellX = $area.Left + $col * $cellW
      $cellY = $area.Top + $row * $cellH

      # Apply EXIF orientation — GDI ignores the tag, so phone photos stored
      # rotated would otherwise print sideways/upside-down.
      if ($img.PropertyIdList -contains 0x0112) {
        $orient = [int]$img.GetPropertyItem(0x0112).Value[0]
        $exifFlip = switch ($orient) {
          2 { [System.Drawing.RotateFlipType]::RotateNoneFlipX }
          3 { [System.Drawing.RotateFlipType]::Rotate180FlipNone }
          4 { [System.Drawing.RotateFlipType]::Rotate180FlipX }
          5 { [System.Drawing.RotateFlipType]::Rotate90FlipX }
          6 { [System.Drawing.RotateFlipType]::Rotate90FlipNone }
          7 { [System.Drawing.RotateFlipType]::Rotate270FlipX }
          8 { [System.Drawing.RotateFlipType]::Rotate270FlipNone }
          default { $null }
        }
        if ($null -ne $exifFlip) { $img.RotateFlip($exifFlip) }
      }

      # Auto-rotate: a landscape source on a portrait cell (or vice versa) would
      # fit-scale down to ~70%. Rotating 90° fills the page as the user expects.
      # Skipped for noscale (actual size honours the original orientation).
      if ($Scale -ne "noscale" -and $sheetFiles.Count -eq 1) {
        $imgLandscape = $img.Width -gt $img.Height
        $cellLandscape = $cellW -gt $cellH
        if ($imgLandscape -ne $cellLandscape) {
          $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone)
        }
      }

      # DPI for actual-size math: prefer the image's own embedded resolution
      # (agent-rendered PNGs carry their render DPI; photos carry EXIF DPI).
      # GDI reports 96 as a made-up default when the file has none — in that
      # case, and for implausible values, fall back to the -RenderDpi param.
      $dpi = $img.HorizontalResolution
      if ($dpi -le 0 -or $dpi -eq 96 -or $dpi -gt 2400) { $dpi = $RenderDpi }

      if ($Scale -eq "noscale" -and $sheetFiles.Count -eq 1) {
        # Actual size: map pixels back to real inches at 100ths-of-inch page units.
        $w = [int]($img.Width / $dpi * 100)
        $h = [int]($img.Height / $dpi * 100)
      } elseif ($Scale -eq "shrink" -and $sheetFiles.Count -eq 1) {
        # Only scale down if the actual-size image would overflow the cell.
        $natW = [int]($img.Width / $dpi * 100)
        $natH = [int]($img.Height / $dpi * 100)
        $ratio = [Math]::Min(1.0, [Math]::Min($cellW / $natW, $cellH / $natH))
        $w = [int]($natW * $ratio)
        $h = [int]($natH * $ratio)
      } else {
        # "default" / "fit": scale to fill the cell, preserving aspect ratio.
        $ratio = [Math]::Min($cellW / $img.Width, $cellH / $img.Height)
        $w = [int]($img.Width * $ratio)
        $h = [int]($img.Height * $ratio)
      }

      $x = [int]($cellX + ($cellW - $w) / 2)
      $y = [int]($cellY + ($cellH - $h) / 2)
      $e.Graphics.DrawImage($img, $x, $y, $w, $h)
    } finally {
      $img.Dispose()
    }
  }

  $state.idx++
  $e.HasMorePages = ($state.idx -lt $state.sheets.Count)
}.GetNewClosure())

$doc.Print()
$doc.Dispose()
Write-Output ("PRINTED " + $sheets.Count + " sheet(s), " + $files.Count + " page(s) on " + $Printer)
