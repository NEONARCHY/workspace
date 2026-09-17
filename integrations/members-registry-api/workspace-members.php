<?php
declare(strict_types=1);

/*
 * Read-only bridge between yuksal21_bot and Yuksalish Workspace.
 * Put this file in public_html/workspace-members.php. Its configuration must
 * live one directory above public_html, where the web server cannot serve it.
 */

$configPath = dirname(__DIR__) . '/private/yuksalish-members-api.php';
if (!is_file($configPath)) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['detail' => 'Members integration is not configured.']);
    exit;
}

/** @var array{dsn: string, username: string, password: string, sharedKey: string} $config */
$config = require $configPath;

function requestHeader(string $name): string
{
    $serverKey = 'HTTP_' . str_replace('-', '_', strtoupper($name));
    if (isset($_SERVER[$serverKey]) && is_string($_SERVER[$serverKey])) {
        return $_SERVER[$serverKey];
    }

    if (function_exists('getallheaders')) {
        foreach (getallheaders() as $headerName => $headerValue) {
            if (strcasecmp($headerName, $name) === 0 && is_string($headerValue)) {
                return $headerValue;
            }
        }
    }

    return '';
}

function rejectAuthentication(string $reason): void
{
    http_response_code(401);
    header('X-Yuksalish-Auth-Error: ' . $reason);
    exit;
}

$timestamp = requestHeader('X-Yuksalish-Timestamp');
$signature = requestHeader('X-Yuksalish-Signature');
$requestPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

if (!ctype_digit($timestamp)) {
    rejectAuthentication('missing-timestamp');
}
if (abs(time() - (int) $timestamp) > 300) {
    rejectAuthentication('expired-timestamp');
}
$message = $timestamp . ".GET\n" . $requestPath . "\n";
$expected = hash_hmac('sha256', $message, $config['sharedKey']);
if (!hash_equals($expected, $signature)) {
    rejectAuthentication('signature-mismatch');
}

try {
    $pdo = new PDO(
        $config['dsn'],
        $config['username'],
        $config['password'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
    );
    $members = $pdo->query(
        "SELECT u.id, CAST(u.tg_id AS CHAR) AS telegram_id, u.username, u.first_name, u.last_name,
                u.language, u.phone, u.status, u.created_at,
                p.region_id, r.name_ru AS region_name_ru, r.name_uz AS region_name_uz,
                p.sphere_id, s.name_ru AS sphere_name_ru, s.name_uz AS sphere_name_uz,
                p.gender, p.birth_date, p.status AS profile_status, p.updated_at
           FROM users u
      LEFT JOIN profiles p ON p.user_id = u.id
      LEFT JOIN regions r ON r.id = p.region_id
      LEFT JOIN spheres s ON s.id = p.sphere_id
       ORDER BY u.created_at DESC, u.id DESC"
    )->fetchAll();
    $regions = $pdo->query('SELECT id, name_ru, name_uz, name_en FROM regions ORDER BY id')->fetchAll();
    $spheres = $pdo->query('SELECT id, name_ru, name_uz, name_en FROM spheres ORDER BY id')->fetchAll();
} catch (PDOException $error) {
    error_log('workspace-members bridge failed: ' . $error->getMessage());
    http_response_code(502);
    $driverCode = isset($error->errorInfo[1]) ? (string) $error->errorInfo[1] : '';
    if ($driverCode === '1045') {
        header('X-Yuksalish-Bridge-Error: source-authentication');
    } elseif ($driverCode === '1049') {
        header('X-Yuksalish-Bridge-Error: source-database');
    } else {
        header('X-Yuksalish-Bridge-Error: source-query');
    }
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['detail' => 'Source database is unavailable.']);
    exit;
} catch (Throwable $error) {
    error_log('workspace-members bridge failed: ' . $error->getMessage());
    http_response_code(502);
    header('X-Yuksalish-Bridge-Error: bridge-runtime');
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['detail' => 'Source database is unavailable.']);
    exit;
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
echo json_encode([
    'configured' => true,
    'generatedAt' => gmdate('c'),
    'members' => $members,
    'regions' => $regions,
    'spheres' => $spheres,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
