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

$files = @( (Get-Content -LiteralPath $FileList) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } )
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

# State held in a hashtable captured by closure (.GetNewClosure). Hashtables are
# reference types, so mutating $state.idx inside the event handler is reliable
# across PowerShell versions — unlike $script:-scope writes inside a .NET event
# delegate, which can silently fail to persist and reprint page 1 forever.
$state = @{ idx = 0; files = $files }

$doc.add_BeginPrint({ $state.idx = 0 }.GetNewClosure())

$doc.add_PrintPage({
  param($sender, $e)
  $img = [System.Drawing.Image]::FromFile($state.files[$state.idx])
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
  $state.idx++
  $e.HasMorePages = ($state.idx -lt $state.files.Count)
}.GetNewClosure())

$doc.Print()
$doc.Dispose()
Write-Output ("PRINTED " + $files.Count + " page(s) on " + $Printer)
