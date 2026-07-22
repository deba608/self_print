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

if ($Copies -lt 1) { $Copies = 1 }
$doc.PrinterSettings.Copies = [int16]$Copies
$doc.PrinterSettings.Collate = ($Collate -eq "true")
$doc.DefaultPageSettings.Landscape = ($Landscape -eq "true")
$doc.DefaultPageSettings.Color = ($Color -eq "true")

# Margins are in hundredths of an inch. "default" leaves the driver's own
# default margins in place instead of forcing zero, unlike the old script.
switch ($Margins) {
  "none"    { $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0,0,0,0) }
  "minimum" { $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(25,25,25,25) }
}

# Match requested paper size if the driver offers it.
$ps = $doc.PrinterSettings.PaperSizes | Where-Object { $_.PaperName -like "*$PaperName*" } | Select-Object -First 1
if ($ps) { $doc.DefaultPageSettings.PaperSize = $ps }

# Double-sided requested: fail loudly if the printer can't duplex, rather than
# silently printing single-sided (which would overcharge/underdeliver). The agent
# surfaces this stderr as the job's failure message so staff can switch the job to
# single-sided or route it to a duplex-capable printer.
if ($Duplex -ne "simplex") {
  if (-not $doc.PrinterSettings.CanDuplex) {
    Write-Error "Printer '$Printer' does not support double-sided (duplex) printing. Set this job to single-sided or use a duplex-capable printer."
    exit 4
  }
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
try {
  Set-PrintConfiguration -PrinterName $Printer -DuplexingMode $queueDuplex -ErrorAction Stop
} catch {
  Write-Output ("WARN: could not set queue duplex mode ($queueDuplex): " + $_.Exception.Message)
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
  $area = $e.MarginBounds

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

      if ($Scale -eq "noscale" -and $sheetFiles.Count -eq 1) {
        # Actual size: map rendered pixels back to real inches at 100ths-of-inch page units.
        $w = [int]($img.Width / $RenderDpi * 100)
        $h = [int]($img.Height / $RenderDpi * 100)
      } elseif ($Scale -eq "shrink" -and $sheetFiles.Count -eq 1) {
        # Only scale down if the actual-size image would overflow the cell.
        $natW = [int]($img.Width / $RenderDpi * 100)
        $natH = [int]($img.Height / $RenderDpi * 100)
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
