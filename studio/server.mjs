import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Studio, StudioError } from './service.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8' };

async function jsonBody(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new StudioError('请使用 JSON 请求', 415);
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 2 * 1024 * 1024) throw new StudioError('文章内容过大', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new StudioError('请求内容不是有效 JSON'); }
}

export function createStudioServer(studio) {
  const token = randomBytes(32).toString('hex');
  const json = (response, value, status = 200) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify(value));
  };
  const server = createServer(async (request, response) => {
    try {
      const port = server.address()?.port;
      const allowedHosts = new Set(['127.0.0.1:' + port, 'localhost:' + port]);
      if (!allowedHosts.has(request.headers.host)) throw new StudioError('仅允许本地写作台访问', 403);
      const origin = 'http://' + request.headers.host;
      const url = new URL(request.url, origin);
      if (request.method !== 'GET') {
        if (request.headers.origin !== origin) throw new StudioError('无效的请求来源', 403);
        const supplied = Buffer.from(String(request.headers['x-studio-token'] || ''));
        const expected = Buffer.from(token);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new StudioError('会话已过期，请刷新写作台', 403);
      }
      if (request.method === 'GET' && url.pathname === '/api/health') return json(response, { studio: true, root: studio.root });
      if (request.method === 'GET' && url.pathname === '/api/bootstrap') return json(response, { ...(await studio.bootstrap()), token });
      if (request.method === 'POST' && url.pathname === '/api/drafts') {
        const body = await jsonBody(request);
        return json(response, await studio.createDraft(body.sourceFile), 201);
      }
      const draftRoute = url.pathname.match(/^\/api\/drafts\/([a-f0-9-]{36})$/);
      if (draftRoute && request.method === 'GET') return json(response, await studio.readDraft(draftRoute[1]));
      if (draftRoute && request.method === 'PUT') {
        const body = await jsonBody(request);
        return json(response, await studio.updateDraft(draftRoute[1], body.version, body.fields));
      }
      if (request.method === 'POST' && url.pathname === '/api/preview') {
        const body = await jsonBody(request);
        return json(response, await studio.preview(body.draftId));
      }
      if (request.method === 'POST' && url.pathname === '/api/review') {
        const body = await jsonBody(request);
        return json(response, await studio.prepareReview(body.draftId));
      }
      if (request.method === 'POST' && url.pathname === '/api/submit') {
        const body = await jsonBody(request);
        return json(response, await studio.submit(body.reviewId, body.message, body.push !== false));
      }
      if (url.pathname.startsWith('/api/')) throw new StudioError('没有找到这个操作', 404);
      if (request.method !== 'GET') throw new StudioError('不支持此操作', 405);

      const previewRoute = url.pathname.match(/^\/preview\/([a-f0-9-]{36})(\/.*)$/);
      if (previewRoute) {
        const file = await studio.previewFile(previewRoute[1], decodeURIComponent(previewRoute[2]));
        let content = file.body;
        if (file.path.endsWith('.html')) {
          content = content.toString('utf8')
            .replace(/<script\b[^>]*\bsrc=["']https?:\/\/[^"']+["'][^>]*>\s*<\/script>/gi, '')
            .replace('media="print" onload="this.media=\'all\'"', 'media="print"')
            .replace(/<\/body>/i, '<script src="/preview-helper.js" defer></script></body>');
        }
        response.writeHead(200, {
          'Content-Type': TYPES[path.extname(file.path)] || 'application/octet-stream',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "sandbox allow-scripts; default-src 'none'; script-src " + origin + "; style-src " + origin + " 'unsafe-inline' https:; font-src https: data:; img-src " + origin + " https: data:; media-src " + origin + " https:; frame-src https:; connect-src 'none'; form-action 'none'; base-uri 'none'"
        });
        return response.end(content);
      }
      const assets = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/preview-helper.js': 'preview-helper.js' };
      const filename = assets[url.pathname];
      if (!filename) throw new StudioError('页面不存在', 404);
      const content = await readFile(path.join(HERE, 'public', filename));
      response.writeHead(200, {
        'Content-Type': TYPES[path.extname(filename)],
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'same-origin',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
      });
      response.end(content);
    } catch (error) {
      if (!response.headersSent && !response.destroyed) json(response, { error: error.message || '操作失败' }, error.status || 500);
    }
  });
  return server;
}

async function start() {
  const studio = new Studio(path.resolve(HERE, '..'));
  await studio.init();
  const server = createStudioServer(studio);
  const initialPort = Number(process.env.STUDIO_PORT || 4310);
  if (!Number.isInteger(initialPort) || initialPort < 1024 || initialPort > 65525) throw new Error('STUDIO_PORT 必须是 1024–65525 的整数');
  for (let port = initialPort; port < initialPort + 10; port++) {
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
      });
      console.log('\n  gochief 写作台已启动\n  http://127.0.0.1:' + port + '\n\n  草稿自动保存在本地。按 Ctrl+C 关闭。\n');
      return;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
      try {
        const existing = await fetch('http://127.0.0.1:' + port + '/api/health', { signal: AbortSignal.timeout(1500) });
        const data = await existing.json();
        if (data.studio && data.root === studio.root) {
          console.log('\n  写作台已在运行：http://127.0.0.1:' + port + '\n');
          return;
        }
      } catch {}
    }
  }
  throw new Error('本地端口已被占用，请使用 STUDIO_PORT 指定其他端口');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().catch(error => { console.error('写作台启动失败：' + error.message); process.exitCode = 1; });
}
