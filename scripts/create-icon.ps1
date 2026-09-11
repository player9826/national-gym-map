Add-Type -AssemblyName System.Drawing
$gymIconDirectory = Join-Path $PSScriptRoot '..\build'
New-Item -ItemType Directory -Path $gymIconDirectory -Force | Out-Null
$gymBitmap = New-Object System.Drawing.Bitmap 256,256
$gymGraphics = [System.Drawing.Graphics]::FromImage($gymBitmap)
$gymGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$gymGraphics.Clear([System.Drawing.Color]::FromArgb(38,117,105))
$gymPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(234,246,240)),12
$gymShape = New-Object System.Drawing.Drawing2D.GraphicsPath
$gymShape.AddBezier(128,222,110,200,53,142,53,98)
$gymShape.AddBezier(53,98,53,8,203,8,203,98)
$gymShape.AddBezier(203,98,203,142,146,200,128,222)
$gymGraphics.DrawPath($gymPen,$gymShape)
$gymBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(169,215,239))
$gymGraphics.FillEllipse($gymBrush,99,70,58,58)
$gymMemory = New-Object System.IO.MemoryStream
$gymBitmap.Save($gymMemory,[System.Drawing.Imaging.ImageFormat]::Png)
$gymBytes = $gymMemory.ToArray()
[System.IO.File]::WriteAllBytes((Join-Path $gymIconDirectory 'icon.png'),$gymBytes)
$gymStream = [System.IO.File]::Create((Join-Path $gymIconDirectory 'icon.ico'))
$gymWriter = New-Object System.IO.BinaryWriter $gymStream
$gymWriter.Write([uint16]0); $gymWriter.Write([uint16]1); $gymWriter.Write([uint16]1)
$gymWriter.Write([byte]0); $gymWriter.Write([byte]0); $gymWriter.Write([byte]0); $gymWriter.Write([byte]0)
$gymWriter.Write([uint16]1); $gymWriter.Write([uint16]32); $gymWriter.Write([uint32]$gymBytes.Length); $gymWriter.Write([uint32]22)
$gymWriter.Write($gymBytes)
$gymWriter.Close(); $gymStream.Dispose(); $gymMemory.Dispose(); $gymShape.Dispose(); $gymPen.Dispose(); $gymBrush.Dispose(); $gymGraphics.Dispose(); $gymBitmap.Dispose()
