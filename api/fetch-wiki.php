<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed.']);
    exit;
}

$pageUrl = trim((string) ($_POST['url'] ?? ''));
if ($pageUrl === '') {
    http_response_code(400);
    echo json_encode(['error' => 'Missing url parameter.']);
    exit;
}

$configCandidates = [
    dirname(__DIR__) . '/config/wiki.local.php',
    '/etc/teleprompter/wiki.local.php',
];

$configPath = null;
foreach ($configCandidates as $candidate) {
    if (is_readable($candidate)) {
        $configPath = $candidate;
        break;
    }
}

if ($configPath === null) {
    $defaultPath = dirname(__DIR__) . '/config/wiki.local.php';
    http_response_code(503);

    if (file_exists($defaultPath) && !is_readable($defaultPath)) {
        echo json_encode([
            'error' => 'config/wiki.local.php exists but Apache cannot read it. Run: sudo chgrp apache config/wiki.local.php && sudo chmod 640 config/wiki.local.php',
        ]);
        exit;
    }

    echo json_encode([
        'error' => 'Private wiki proxy is not configured. Copy config/wiki.local.php.example to config/wiki.local.php on the server.',
    ]);
    exit;
}

$config = require $configPath;
$allowedHosts = $config['allowed_hosts'] ?? [];
$wikis = $config['wikis'] ?? [];

try {
    $parsed = parseMediaWikiPageUrl($pageUrl);
} catch (RuntimeException $e) {
    http_response_code(400);
    echo json_encode(['error' => $e->getMessage()]);
    exit;
}

if (!in_array($parsed['host'], $allowedHosts, true)) {
    http_response_code(403);
    echo json_encode(['error' => 'That wiki host is not allowed by the server proxy.']);
    exit;
}

$wikiConfig = $wikis[$parsed['host']] ?? null;
if ($wikiConfig === null) {
    http_response_code(503);
    echo json_encode(['error' => 'No proxy credentials are configured for that wiki host.']);
    exit;
}

try {
    $client = new MediaWikiClient(
        $wikiConfig['api_url'],
        $wikiConfig['username'],
        $wikiConfig['password']
    );
    $result = $client->fetchPageText($parsed['page_title']);
    echo json_encode($result);
} catch (RuntimeException $e) {
    http_response_code(502);
    echo json_encode(['error' => $e->getMessage()]);
}

function parseMediaWikiPageUrl(string $input): array
{
    $parts = parse_url($input);
    if ($parts === false || empty($parts['host'])) {
        throw new RuntimeException('That does not look like a valid URL.');
    }

    $host = strtolower($parts['host']);
    $path = $parts['path'] ?? '';
    $pageTitle = null;

    if (preg_match('#/wiki/([^/?#]+)#', $path, $matches)) {
        $pageTitle = urldecode(str_replace('+', ' ', $matches[1]));
    } elseif (!empty($parts['query'])) {
        parse_str($parts['query'], $query);
        if (!empty($query['title'])) {
            $pageTitle = str_replace('+', ' ', $query['title']);
        }
    } elseif (preg_match('#/index\.php/([^/?#]+)#', $path, $matches)) {
        $pageTitle = urldecode(str_replace('+', ' ', $matches[1]));
    }

    if ($pageTitle === null || $pageTitle === '') {
        throw new RuntimeException('Could not find a page title in that URL.');
    }

    return [
        'host' => $host,
        'page_title' => $pageTitle,
    ];
}

final class MediaWikiClient
{
    private string $apiUrl;
    private string $username;
    private string $password;
    private string $cookieFile;

    public function __construct(string $apiUrl, string $username, string $password)
    {
        $this->apiUrl = $apiUrl;
        $this->username = $username;
        $this->password = $password;
        $this->cookieFile = tempnam(sys_get_temp_dir(), 'mw_cookie_');
    }

    public function __destruct()
    {
        if ($this->cookieFile && file_exists($this->cookieFile)) {
            unlink($this->cookieFile);
        }
    }

    public function fetchPageText(string $pageTitle): array
    {
        $this->login();

        $data = $this->request([
            'action' => 'parse',
            'page' => $pageTitle,
            'prop' => 'text',
            'disableeditsection' => '1',
        ]);

        if (!empty($data['error'])) {
            throw new RuntimeException($data['error']['info'] ?? 'The wiki returned an error.');
        }

        $html = $data['parse']['text']['*'] ?? '';
        if ($html === '') {
            throw new RuntimeException('No page content was returned.');
        }

        $text = htmlToPlainText($html);
        if ($text === '') {
            throw new RuntimeException('The page appears to be empty.');
        }

        return [
            'title' => $data['parse']['title'] ?? $pageTitle,
            'text' => $text,
        ];
    }

    private function login(): void
    {
        $tokenData = $this->request([
            'action' => 'query',
            'meta' => 'tokens',
            'type' => 'login',
        ]);

        $token = $tokenData['query']['tokens']['logintoken'] ?? '';
        if ($token === '') {
            throw new RuntimeException('Could not obtain a wiki login token.');
        }

        $loginData = $this->request([
            'action' => 'login',
            'lgname' => $this->username,
            'lgpassword' => $this->password,
            'lgtoken' => $token,
        ]);

        if (($loginData['login']['result'] ?? '') !== 'Success') {
            $message = $loginData['login']['reason'] ?? 'Wiki login failed.';
            throw new RuntimeException($message);
        }
    }

    private function request(array $params): array
    {
        $params['format'] = 'json';
        $query = http_build_query($params);

        $ch = curl_init($this->apiUrl);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $query,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_COOKIEJAR => $this->cookieFile,
            CURLOPT_COOKIEFILE => $this->cookieFile,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded'],
        ]);

        $body = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        if ($body === false) {
            throw new RuntimeException('Wiki request failed: ' . $curlError);
        }

        if ($status >= 400) {
            throw new RuntimeException('Wiki request failed (' . $status . ').');
        }

        $data = json_decode($body, true);
        if (!is_array($data)) {
            throw new RuntimeException('Wiki returned an invalid response.');
        }

        return $data;
    }
}

function htmlToPlainText(string $html): string
{
    $document = new DOMDocument();
    libxml_use_internal_errors(true);
    $document->loadHTML('<?xml encoding="UTF-8">' . $html, LIBXML_NOWARNING | LIBXML_NOERROR);
    libxml_clear_errors();

    $xpath = new DOMXPath($document);
    $removeQueries = [
        '//sup[contains(@class,"reference")]',
        '//*[contains(@class,"mw-references-wrap")]',
        '//*[contains(@class,"navbox")]',
        '//*[contains(@class,"metadata")]',
        '//*[contains(@class,"noprint")]',
        '//*[contains(@class,"ambox")]',
        '//*[contains(@class,"infobox")]',
        '//*[contains(@class,"hatnote")]',
        '//*[contains(@class,"shortdescription")]',
        '//style',
        '//script',
    ];

    foreach ($removeQueries as $query) {
        foreach ($xpath->query($query) as $node) {
            $node->parentNode?->removeChild($node);
        }
    }

    $text = $document->textContent ?? '';
    $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $text = str_replace("\xc2\xa0", ' ', $text);
    $text = preg_replace("/\r\n/", "\n", $text);
    $text = preg_replace("/\n{3,}/", "\n\n", $text);

    return trim($text);
}
