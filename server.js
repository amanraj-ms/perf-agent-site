const express = require('express');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 8000;

// ─── Config ──────────────────────────────────────────────────
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'amanraj-ms';
const GITHUB_REPO  = process.env.GITHUB_REPO  || 'copilot-perf-agent';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── In-memory cache ─────────────────────────────────────────
let releasesCache = { data: null, fetchedAt: 0 };

function githubFetch(apiPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: apiPath,
      method: 'GET',
      headers: {
        'User-Agent': 'perf-agent-website',
        'Accept': 'application/vnd.github.v3+json',
        ...(GITHUB_TOKEN && { 'Authorization': `token ${GITHUB_TOKEN}` }),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error('Invalid JSON from GitHub API')); }
        } else {
          reject(new Error(`GitHub API ${res.statusCode}: ${body.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function githubStream(url, res) {
  const parsed = new URL(url);
  const options = {
    hostname: parsed.hostname,
    path: parsed.pathname + parsed.search,
    method: 'GET',
    headers: {
      'User-Agent': 'perf-agent-website',
      'Accept': 'application/octet-stream',
      ...(GITHUB_TOKEN && { 'Authorization': `token ${GITHUB_TOKEN}` }),
    },
  };

  const req = https.request(options, (upstream) => {
    // GitHub returns 302 redirect for asset downloads
    if (upstream.statusCode === 302 || upstream.statusCode === 301) {
      return githubStream(upstream.headers.location, res);
    }
    if (upstream.statusCode !== 200) {
      res.status(upstream.statusCode).json({ error: 'Download failed' });
      return;
    }
    // Forward headers
    if (upstream.headers['content-type'])        res.setHeader('Content-Type', upstream.headers['content-type']);
    if (upstream.headers['content-length'])      res.setHeader('Content-Length', upstream.headers['content-length']);
    if (upstream.headers['content-disposition']) res.setHeader('Content-Disposition', upstream.headers['content-disposition']);
    upstream.pipe(res);
  });
  req.on('error', () => res.status(502).json({ error: 'Download stream failed' }));
  req.end();
}

async function fetchReleases() {
  const now = Date.now();
  if (releasesCache.data && (now - releasesCache.fetchedAt) < CACHE_TTL_MS) {
    return releasesCache.data;
  }

  const raw = await githubFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=20`);
  const releases = raw.map((r) => ({
    id: r.id,
    tag: r.tag_name,
    name: r.name || r.tag_name,
    body: r.body || '',
    prerelease: r.prerelease,
    draft: r.draft,
    published_at: r.published_at,
    html_url: r.html_url,
    assets: (r.assets || []).map((a) => ({
      id: a.id,
      name: a.name,
      size: a.size,
      download_count: a.download_count,
      content_type: a.content_type,
    })),
  }));

  releasesCache = { data: releases, fetchedAt: now };
  return releases;
}

// ─── Static files ────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '5m',
  etag: true,
  setHeaders: (res, filePath) => {
    // No cache for HTML (always get fresh from server)
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  },
}));

// ─── API: All releases ──────────────────────────────────────
app.get('/api/releases', async (req, res) => {
  try {
    const releases = await fetchReleases();
    res.json(releases);
  } catch (err) {
    console.error('Failed to fetch releases:', err.message);
    res.status(502).json({ error: 'Failed to fetch releases from GitHub' });
  }
});

// ─── API: Latest release ────────────────────────────────────
app.get('/api/releases/latest', async (req, res) => {
  try {
    const releases = await fetchReleases();
    const latest = releases.find((r) => !r.prerelease && !r.draft) || releases[0];
    if (!latest) return res.status(404).json({ error: 'No releases found' });
    res.json(latest);
  } catch (err) {
    console.error('Failed to fetch latest release:', err.message);
    res.status(502).json({ error: 'Failed to fetch latest release' });
  }
});

// ─── API: Download asset (proxy) ─────────────────────────────
app.get('/api/download/:assetId', (req, res) => {
  const assetId = req.params.assetId;
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/assets/${assetId}`;
  githubStream(url, res);
});

// ─── Health check ────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    github_configured: !!GITHUB_TOKEN,
  });
});

// ─── Perf test endpoint ─────────────────────────────────────
let perfHitCount = 0;
app.get('/api/perf-test', (req, res) => {
  perfHitCount++;
  const start = process.hrtime.bigint();

  const origin = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';
  const referer = req.headers['referer'] || req.headers['origin'] || 'direct';

  // Simulate a tiny compute delay (0–5ms) to make response times realistic
  const delay = Math.random() * 5;
  setTimeout(() => {
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6; // ms

    const payload = {
      status: 'ok',
      endpoint: '/api/perf-test',
      hit: perfHitCount,
      timestamp: new Date().toISOString(),
      response_time_ms: Math.round(elapsed * 100) / 100,
      request: {
        origin,
        user_agent: userAgent,
        referer,
        method: req.method,
      },
      server: {
        uptime: process.uptime(),
        memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024 * 100) / 100,
      },
    };

    console.log(`[PERF] #${perfHitCount} | ${req.method} /api/perf-test | ${elapsed.toFixed(1)}ms | origin=${origin} | ua=${userAgent.slice(0, 60)}`);
    res.json(payload);
  }, delay);
});

// SPA fallback — serve index.html for all unmatched routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`⚡ Performance Agent website running on port ${PORT}`);
  console.log(`   GitHub releases proxy: ${GITHUB_TOKEN ? 'configured' : '⚠️  GITHUB_TOKEN not set'}`);
});
