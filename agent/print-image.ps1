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
  [string]$Duplex = "simplex"         # simplex | long-edge | short-edge
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

# Duplex only applied if the driver actually supports it — otherwise the
# selection is silently dropped rather than failing the whole print job.
if ($Duplex -ne "simplex" -and $doc.PrinterSettings.CanDuplex) {
  $doc.PrinterSettings.Duplex = if ($Duplex -eq "short-edge") {
    [System.Drawing.Printing.Duplex]::Horizontal
  } else {
    [System.Drawing.Printing.Duplex]::Vertical
  }
} else {
  $doc.PrinterSettings.Duplex = [System.Drawing.Printing.Duplex]::Simplex
}

if ($PagesPerSheet -lt 1) { $PagesPerSheet = 1 }

# Group source images into physical sheets of $PagesPerSheet each.
$sheets = New-Object System.Collections.ArrayList
for ($i = 0; $i -lt $files.Count; $i += $PagesPerSheet) {
  $end = [Math]::Min($i + $PagesPerSheet, $files.Count) - 1
  [void]$sheets.Add(@($files[$i..$end]))
}

# DPI the PDF rasteriser renders at (scale:3 in agent/src/index.ts => ~216 DPI
# for A4). Needed to convert pixel dimensions back to real-world inches for
# "shrink" / "noscale".
$RenderDpi = 216

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
