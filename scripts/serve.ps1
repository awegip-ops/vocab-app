# Minimal static file server used by the desktop launcher (실행.vbs).
# Uses only what ships with Windows (PowerShell + .NET HttpListener) so the
# launcher works on any Windows 10/11 PC without installing anything.

param(
    [string]$Root = (Get-Location).Path,
    [int]$Port = 5500
)

$ErrorActionPreference = "Stop"
$rootFull = (Resolve-Path -LiteralPath $Root).Path

# The launcher starts this script with WScript.Shell's Run (window style
# hidden) rather than Exec, specifically so no window ever gets created in
# the first place - on Windows 11, Exec forces a real console to exist (it
# captures stdio), and Windows Terminal then shows that console as a
# visible tab regardless of -WindowStyle Hidden. Run has no such window at
# all, but that means the launcher has no ProcessID to kill later, so this
# script writes its own PID to a file next to itself for the launcher to
# read and clean up once the app window closes.
$pidFile = Join-Path $rootFull ".server-$Port.pid"
Set-Content -LiteralPath $pidFile -Value $PID -Encoding Ascii

$mimeMap = @{
    ".html"        = "text/html; charset=utf-8"
    ".htm"         = "text/html; charset=utf-8"
    ".js"          = "text/javascript; charset=utf-8"
    ".mjs"         = "text/javascript; charset=utf-8"
    ".css"         = "text/css; charset=utf-8"
    ".json"        = "application/json; charset=utf-8"
    ".webmanifest" = "application/manifest+json; charset=utf-8"
    ".png"         = "image/png"
    ".jpg"         = "image/jpeg"
    ".jpeg"        = "image/jpeg"
    ".svg"         = "image/svg+xml; charset=utf-8"
    ".ico"         = "image/x-icon"
    ".txt"         = "text/plain; charset=utf-8"
    ".md"          = "text/markdown; charset=utf-8"
    ".mp3"         = "audio/mpeg"
    ".woff"        = "font/woff"
    ".woff2"       = "font/woff2"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
    } catch {
        break
    }

    $request = $context.Request
    $response = $context.Response
    try {
        $urlPath = [Uri]::UnescapeDataString($request.Url.AbsolutePath)
        if ($urlPath -eq "/") { $urlPath = "/index.html" }

        $filePath = [IO.Path]::GetFullPath((Join-Path $rootFull $urlPath.TrimStart("/")))

        if (-not $filePath.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
            $response.StatusCode = 403
        } elseif (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
            $response.StatusCode = 404
        } else {
            $ext = [IO.Path]::GetExtension($filePath).ToLowerInvariant()
            $contentType = $mimeMap[$ext]
            if (-not $contentType) { $contentType = "application/octet-stream" }
            $response.ContentType = $contentType
            # Audio needs byte-range support or the browser can't seek (the listen-mode
            # audio jumps between words by seeking) - same thing GitHub Pages does.
            $response.AddHeader("Accept-Ranges", "bytes")
            $fileLength = (Get-Item -LiteralPath $filePath).Length
            $rangeHeader = $request.Headers["Range"]
            $start = 0
            $end = $fileLength - 1
            $partial = $false
            if ($rangeHeader -match '^bytes=(\d*)-(\d*)$') {
                if ($Matches[1] -ne "") {
                    $start = [long]$Matches[1]
                    if ($Matches[2] -ne "") { $end = [Math]::Min([long]$Matches[2], $fileLength - 1) }
                } elseif ($Matches[2] -ne "") {
                    $start = [Math]::Max(0, $fileLength - [long]$Matches[2])
                }
                $partial = $true
            }
            if ($partial -and ($start -gt $end -or $start -ge $fileLength)) {
                $response.StatusCode = 416
                $response.AddHeader("Content-Range", "bytes */$fileLength")
            } elseif ($partial) {
                $count = $end - $start + 1
                $response.StatusCode = 206
                $response.AddHeader("Content-Range", "bytes $start-$end/$fileLength")
                $response.ContentLength64 = $count
                if ($request.HttpMethod -ne "HEAD") {
                    $stream = [IO.File]::OpenRead($filePath)
                    try {
                        [void]$stream.Seek($start, [IO.SeekOrigin]::Begin)
                        $buffer = New-Object byte[] 65536
                        $remaining = $count
                        while ($remaining -gt 0) {
                            $read = $stream.Read($buffer, 0, [int][Math]::Min($buffer.Length, $remaining))
                            if ($read -le 0) { break }
                            $response.OutputStream.Write($buffer, 0, $read)
                            $remaining -= $read
                        }
                    } finally {
                        $stream.Dispose()
                    }
                }
            } else {
                $response.ContentLength64 = $fileLength
                if ($request.HttpMethod -ne "HEAD") {
                    $bytes = [IO.File]::ReadAllBytes($filePath)
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                }
            }
        }
    } catch {
        # Browsers routinely abort media requests mid-transfer (every seek does), which
        # surfaces here as a write error - not worth taking the whole server down.
        try { $response.StatusCode = 500 } catch {}
    } finally {
        try { $response.OutputStream.Close() } catch {}
    }
}
