// Zero-dependency static dev server with live-reload.
// Usage: node serve.mjs [port]   (default 5173)
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';

const ROOT = path.join(process.cwd(), 'public'); // same dir Cloudflare serves
const PORT = Number(process.argv[2]) || 5173;
const DEFAULT_FILE = 'index.html';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

// Connected browsers, kept open for Server-Sent-Events live-reload.
const clients = new Set();

const RELOAD_SNIPPET = `
<script>
(function(){
  try {
    var es = new EventSource('/__livereload');
    es.onmessage = function(e){ if (e.data === 'reload') location.reload(); };
  } catch (err) {}
})();
</script>`;

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let pathname = decodeURIComponent(url.pathname);

    // Live-reload event stream
    if (pathname === '/__livereload') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (pathname === '/') pathname = '/' + DEFAULT_FILE;

    // Resolve inside ROOT only (block path traversal).
    const filePath = path.join(ROOT, pathname);
    const rel = path.relative(ROOT, filePath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return send(res, 403, 'Forbidden');

    let stat;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      return send(res, 404, 'Not found: ' + pathname);
    }
    if (stat.isDirectory()) return send(res, 404, 'Not found: ' + pathname);

    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';

    // Inject the live-reload client into HTML responses.
    if (ext === '.html') {
      const html = (await fsp.readFile(filePath, 'utf8')) + RELOAD_SNIPPET;
      return send(res, 200, html, { 'Content-Type': type });
    }

    res.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    send(res, 500, 'Server error: ' + err.message);
  }
});

// Watch the project and push a reload on any change (ignore node_modules/.git).
let timer;
try {
  fs.watch(ROOT, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const f = filename.toString();
    if (f.includes('node_modules') || f.startsWith('.git')) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const c of clients) c.write('data: reload\n\n');
    }, 100);
  });
} catch (err) {
  console.warn('File watching unavailable:', err.message);
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use. Start on another port with:\n     node serve.mjs 5174\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  const openUrl = `http://localhost:${PORT}/`;
  console.log(`\n  ▶  Serving "${ROOT}"`);
  console.log(`     ${openUrl}`);
  console.log('     Press Ctrl+C to stop.\n');
  // Open the default browser.
  if (process.platform === 'win32') exec(`start "" "${openUrl}"`);
  else if (process.platform === 'darwin') exec(`open "${openUrl}"`);
  else exec(`xdg-open "${openUrl}"`);
});
