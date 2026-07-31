# Minimal static file server used by the desktop launcher (실행.vbs).
# Uses only what ships with Windows (PowerShell + .NET HttpListener) so the
# launcher works on any Windows 10/11 PC without installing anything.

param(
    [string]$Root = (Get-Location).Path,
    [int]$Port = 5500
)

$ErrorActionPreference = "Stop"
$rootFull = (Resolve-Path -LiteralPath $Root).Path

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
            $bytes = [IO.File]::ReadAllBytes($filePath)
            $response.ContentType = $contentType
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
    } catch {
        try { $response.StatusCode = 500 } catch {}
    } finally {
        $response.OutputStream.Close()
    }
}
