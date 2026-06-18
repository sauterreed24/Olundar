import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 4173);

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${port}`);
  const cleanPath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  let filePath = path.resolve(root, cleanPath || 'index.html');
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  });
  createReadStream(filePath).pipe(res);
});

server.listen(port, () => {
  console.log(`Olundar prototype running at http://localhost:${port}`);
});
