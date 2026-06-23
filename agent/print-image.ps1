param(
  [Parameter(Mandatory=$true)][string]$Printer,
  [Parameter(Mandatory=$true)][string]$FileList,  # newline-separated image paths, in page order
  [int]$Copies = 1,
  [string]$Color = "true",
  [string]$Landscape = "false",
  [string]$PaperName = "A4"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$files = (Get-Content -LiteralPath $FileList) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
if (-not $files -or $files.Count -eq 0) { Write-Error "No image files to print."; exit 3 }

$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = $Printer
if (-not $doc.PrinterSettings.IsValid) { Write-Error "Invalid printer: $Printer"; exit 2 }

if ($Copies -lt 1) { $Copies = 1 }
$doc.PrinterSettings.Copies = [int16]$Copies
$doc.DefaultPageSettings.Landscape = ($Landscape -eq "true")
$doc.DefaultPageSettings.Color = ($Color -eq "true")
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0,0,0,0)

# Match requested paper size if the driver offers it.
$ps = $doc.PrinterSettings.PaperSizes | Where-Object { $_.PaperName -like "*$PaperName*" } | Select-Object -First 1
if ($ps) { $doc.DefaultPageSettings.PaperSize = $ps }

$script:idx = 0
$doc.add_BeginPrint({ $script:idx = 0 })

$doc.add_PrintPage({
  param($sender, $e)
  $img = [System.Drawing.Image]::FromFile($files[$script:idx])
  try {
    $area = $e.MarginBounds
    $ratio = [Math]::Min($area.Width / $img.Width, $area.Height / $img.Height)
    $w = [int]($img.Width * $ratio)
    $h = [int]($img.Height * $ratio)
    $x = $area.Left + [int](($area.Width  - $w) / 2)
    $y = $area.Top  + [int](($area.Height - $h) / 2)
    $e.Graphics.DrawImage($img, $x, $y, $w, $h)
  } finally {
    $img.Dispose()
  }
  $script:idx++
  $e.HasMorePages = ($script:idx -lt $files.Count)
})

$doc.Print()
$doc.Dispose()
Write-Output ("PRINTED " + $files.Count + " page(s) on " + $Printer)
