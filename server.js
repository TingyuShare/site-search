/* Zero-dependency static file server (Node built-in http module)
 * Usage: node server.js [port]   default port 8080
 *
 * Features:
 *   - Serves static files
 *   - Handles /search route with custom site analysis
 *     - Reads q parameter from query string
 *     - If first word matches a configured site key, appends site:<domain>
 *     - Redirects to search engine
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// Load configuration
let config = null;
try {
  const configPath = path.join(ROOT, 'config.json');
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log('Config loaded:', configPath);
} catch (e) {
  console.warn('Warning: config.json not found or invalid, using defaults');
  config = { sites: {}, defaultEngine: 'google' };
}

const ENGINES = {
  google: 'https://www.google.com/search',
  bing: 'https://www.bing.com/search',
};

function getCustomSites() {
  return config.sites || {};
}

function getEngine() {
  const engineKey = (config.defaultEngine || 'google').toLowerCase();
  return ENGINES[engineKey] || ENGINES.google;
}

function analyzeQuery(query) {
  if (!query) return query;
  
  const sites = getCustomSites();
  const words = query.trim().split(/\s+/);
  if (words.length === 0) return query;
  
  const firstWord = words[0].toLowerCase();
  
  // Check if first word exactly matches a configured site key (case-insensitive)
  for (const [key, domain] of Object.entries(sites)) {
    if (key.toLowerCase() === firstWord) {
      // Append site:<domain> to the end of the query
      return `${query} site:${domain}`;
    }
  }
  
  return query;
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Handle /search route
  if (pathname === '/search') {
    const q = parsedUrl.query.q || '';
    const analyzedQuery = analyzeQuery(q);
    const engineUrl = getEngine();
    const searchUrl = `${engineUrl}?q=${encodeURIComponent(analyzedQuery)}`;
    res.writeHead(302, { 'Location': searchUrl });
    res.end();
    return;
  }

  // Prevent path traversal
  let urlPath = decodeURIComponent(parsedUrl.path || req.url);
  // Remove query string for file path
  urlPath = urlPath.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found: ' + urlPath);
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`SiteSearch started: http://localhost:${PORT}`);
  console.log(`Search route: http://localhost:${PORT}/search?q=<query>`);
});