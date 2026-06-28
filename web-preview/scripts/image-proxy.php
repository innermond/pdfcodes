<?php
/**
 * Reference image proxy for the "Crează fundal" remote-URL background source.
 *
 * The web app fetches `IMAGE_PROXY + encodeURIComponent(targetUrl)`, so this
 * script reads the target from `?url=` and streams the remote image back from
 * the same origin (sidestepping the browser's CORS restrictions).
 *
 * Local dev:
 *   php -S localhost:8000 web-preview/scripts/image-proxy.php
 *   # web-preview/.env.local: VITE_IMAGE_PROXY=http://localhost:8000/?url=
 *
 * Production: port this logic to a Laravel route/controller and point
 *   VITE_IMAGE_PROXY at it (e.g. /image-proxy?url=).
 *
 * Safeguards: http(s) only, blocks private/reserved IPs (SSRF), caps the
 * response size, and validates the bytes are actually PNG or JPEG.
 */

// Allow the Vite dev server (different port = cross-origin) to read the response.
// In production (same-origin Laravel) this is harmless; tighten to your origin.
header('Access-Control-Allow-Origin: *');

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB cap

function fail(int $status, string $message): never {
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    echo $message;
    exit;
}

$url = $_GET['url'] ?? '';
if ($url === '') {
    fail(400, 'Missing url parameter.');
}

$parts = parse_url($url);
if ($parts === false || empty($parts['scheme']) || empty($parts['host'])) {
    fail(400, 'Invalid URL.');
}
if (!in_array(strtolower($parts['scheme']), ['http', 'https'], true)) {
    fail(400, 'Only http and https URLs are allowed.');
}

// SSRF guard: resolve the host and reject private / reserved addresses.
$host = $parts['host'];
$ips = array_merge(
    (array) @gethostbynamel($host),
    array_column(@dns_get_record($host, DNS_AAAA) ?: [], 'ipv6')
);
if (!$ips) {
    fail(400, 'Could not resolve host.');
}
foreach ($ips as $ip) {
    if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
        fail(403, 'Target host is not allowed.');
    }
}

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 3,
    CURLOPT_TIMEOUT => 15,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
    CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
    CURLOPT_BUFFERSIZE => 65536,
    CURLOPT_NOPROGRESS => false,
    CURLOPT_PROGRESSFUNCTION => static function ($ch, $dlTotal, $dlNow) {
        return $dlNow > MAX_BYTES ? 1 : 0; // non-zero aborts the transfer
    },
]);

$body = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$err = curl_errno($ch);
curl_close($ch);

if ($err || $body === false) {
    fail(502, 'Failed to fetch the remote image.');
}
if ($status < 200 || $status >= 300) {
    fail(502, "Remote returned HTTP $status.");
}
if (strlen($body) > MAX_BYTES) {
    fail(413, 'Image is too large.');
}

// Validate the bytes are actually PNG or JPEG (matches the client-side check).
$head = substr($body, 0, 4);
$isPng = $head === "\x89PNG";
$isJpeg = strlen($body) >= 3 && substr($body, 0, 3) === "\xFF\xD8\xFF";
if (!$isPng && !$isJpeg) {
    fail(415, 'Only PNG or JPEG images are allowed.');
}

header('Content-Type: ' . ($isPng ? 'image/png' : 'image/jpeg'));
header('Content-Length: ' . strlen($body));
echo $body;
