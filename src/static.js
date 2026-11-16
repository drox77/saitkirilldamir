import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.svg', '.txt', '.xml']);

function buildAsset(ext, body) {
  const asset = {
    type: TYPES[ext],
    isHtml: ext === '.html',
    body,
    etag: `W/"${crypto.createHash('sha1').update(body).digest('base64url').slice(0, 20)}"`,
  };
  if (COMPRESSIBLE.has(ext)) {
    asset.br = zlib.brotliCompressSync(body);
    asset.gzip = zlib.gzipSync(body, { level: 9 });
  }
  return asset;
}

function robotsTxt(siteUrl) {
  return ['User-agent: *', 'Allow: /', 'Disallow: /api/', '', `Sitemap: ${siteUrl}/sitemap.xml`, ''].join('\n');
}

function sitemapXml(siteUrl, lastModified) {
  const urls = ['/', '/privacy.html']
    .map((page) => `  <url><loc>${siteUrl}${page}</loc><lastmod>${lastModified}</lastmod></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

// Читает public целиком в память: файлов мало, а поиск по точному ключу исключает обход каталогов.
export function loadAssets({ publicDir, siteUrl }) {
  const files = fs
    .readdirSync(publicDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) => {
      const absolute = path.join(entry.parentPath, entry.name);
      return {
        urlPath: `/${path.relative(publicDir, absolute).split(path.sep).join('/')}`,
        ext: path.extname(entry.name).toLowerCase(),
        body: fs.readFileSync(absolute),
        modified: fs.statSync(absolute).mtime,
      };
    })
    .filter((file) => TYPES[file.ext])
    .sort((a, b) => a.urlPath.localeCompare(b.urlPath));

  const digest = crypto.createHash('sha1');
  for (const file of files) digest.update(file.urlPath).update(file.body);
  const version = digest.digest('hex').slice(0, 10);

  const assets = new Map();
  for (const file of files) {
    let body = file.body;
    if (file.ext === '.html') {
      const html = body.toString('utf8').replaceAll('{{SITE_URL}}', siteUrl).replaceAll('{{ASSET_VERSION}}', version);
      body = Buffer.from(html);
    }
    assets.set(file.urlPath, buildAsset(file.ext, body));
  }

  const lastModified = new Date(Math.max(...files.map((file) => file.modified.getTime()))).toISOString().slice(0, 10);
  assets.set('/', assets.get('/index.html'));
  assets.set('/robots.txt', buildAsset('.txt', Buffer.from(robotsTxt(siteUrl))));
  assets.set('/sitemap.xml', buildAsset('.xml', Buffer.from(sitemapXml(siteUrl, lastModified))));

  return { assets, version };
}

export function sendAsset(req, res, asset, { status = 200, immutable = false } = {}) {
  let cacheControl = 'public, max-age=3600';
  if (asset.isHtml) cacheControl = 'no-cache';
  else if (immutable) cacheControl = 'public, max-age=31536000, immutable';

  const headers = { 'Content-Type': asset.type, ETag: asset.etag, 'Cache-Control': cacheControl };
  if (asset.br) headers.Vary = 'Accept-Encoding';

  if (status === 200 && (req.headers['if-none-match'] || '').includes(asset.etag)) {
    res.writeHead(304, headers);
    res.end();
    return;
  }

  let body = asset.body;
  const accepted = req.headers['accept-encoding'] || '';
  if (asset.br && /\bbr\b/.test(accepted)) {
    body = asset.br;
    headers['Content-Encoding'] = 'br';
  } else if (asset.gzip && /\bgzip\b/.test(accepted)) {
    body = asset.gzip;
    headers['Content-Encoding'] = 'gzip';
  }

  headers['Content-Length'] = body.length;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}
