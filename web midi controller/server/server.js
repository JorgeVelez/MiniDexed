const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

const PORT = 3000;
const ROOT = path.join(__dirname, '..');

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
};

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function isAllowedHost(hostname) {
  return hostname === 'github.com' ||
         hostname.endsWith('.github.com') ||
         hostname.endsWith('.githubusercontent.com');
}

function proxyFetch(targetUrl, headers, res, depth = 0) {
  if (depth > 5) { res.writeHead(502); res.end('Too many redirects'); return; }

  const parsed = new URL(targetUrl);
  if (!isAllowedHost(parsed.hostname)) {
    console.log(`[proxy] blocked host: ${parsed.hostname}`);
    res.writeHead(403); res.end('Forbidden host'); return;
  }

  console.log(`[proxy] GET ${targetUrl}`);
  https.get(targetUrl, { headers }, upstream => {
    console.log(`[proxy] ${upstream.statusCode} ${targetUrl.substring(0, 80)}`);
    if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
      upstream.resume();
      const nextHeaders = { ...headers };
      if (upstream.headers['set-cookie']) {
        nextHeaders['Cookie'] = upstream.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
      }
      proxyFetch(upstream.headers.location, nextHeaders, res, depth + 1);
      return;
    }
    res.writeHead(upstream.statusCode, {
      'Content-Type': upstream.headers['content-type'] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
    });
    upstream.pipe(res);
  }).on('error', err => { res.writeHead(502); res.end(err.message); });
}

http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  if (parsed.pathname === '/proxy') {
    const target = parsed.query.url;
    if (!target) { res.writeHead(400); res.end('Missing url param'); return; }
    proxyFetch(target, { Accept: '*/*', 'User-Agent': BROWSER_UA }, res);
    return;
  }

  const urlPath = req.url === '/' ? '/index.html' : req.url;
  const file    = path.join(ROOT, urlPath);

  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext  = path.extname(file);
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
