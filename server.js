// Polyfill globalThis.crypto for Azure SDK on Node.js 18
const { webcrypto } = require('crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const path = require('path');
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');
const { readJson, writeJson } = require('./storage');

const app = express();
const PORT = process.env.PORT || 8000;

// ─── Trust proxy (required behind reverse proxy / Azure App Service) ──
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);
}
app.disable('x-powered-by');

// ─── Config ──────────────────────────────────────────────────
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'amanraj-ms';
const GITHUB_REPO  = process.env.GITHUB_REPO  || 'copilot-perf-agent';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const ADMIN_PASS    = process.env.ADMIN_PASS;
if (!ADMIN_PASS) {
  console.error('\x1b[31m[FATAL] ADMIN_PASS environment variable is required. Exiting.\x1b[0m');
  process.exit(1);
}
const SESSION_TTL   = 5 * 60 * 1000; // 5 minutes
const DATA_DIR      = path.join(__dirname, 'data');
const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
const DOWNLOAD_LINK_TTL = 1 * 60 * 60 * 1000; // 1 hour

async function readApprovals() { return readJson('approvals.json', []); }
async function writeApprovals(approvals) { return writeJson('approvals.json', approvals); }
async function readRejections() { return readJson('rejections.json', []); }
async function writeRejections(rejections) { return writeJson('rejections.json', rejections); }
async function readDeletions() { return readJson('deletions.json', []); }
async function writeDeletions(deletions) { return writeJson('deletions.json', deletions); }
async function readDownloads() { return readJson('downloads.json', {}); }
async function writeDownloads(downloads) { return writeJson('downloads.json', downloads); }

// ─── Atomic download marking (prevents race conditions) ──────
const pendingDownloads = new Set();

async function markDownloadUsed(dlKey, email, assetId, releaseTag) {
  // In-memory lock to prevent concurrent race
  if (pendingDownloads.has(dlKey)) {
    return { used_at: new Date().toISOString() }; // treat concurrent as already-used
  }
  pendingDownloads.add(dlKey);
  try {
    const downloads = await readDownloads();
    if (downloads[dlKey]) {
      return downloads[dlKey]; // already used
    }
    downloads[dlKey] = { used_at: new Date().toISOString(), email, assetId, releaseTag };
    await writeDownloads(downloads);
    return null; // success — not previously used
  } finally {
    pendingDownloads.delete(dlKey);
  }
}

// ─── In-memory admin sessions ────────────────────────────────
const adminSessions = new Map();  // token → { createdAt, lastActivity }

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  adminSessions.set(token, { createdAt: Date.now(), lastActivity: Date.now() });
  return token;
}

function validateSession(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return false;
  const session = adminSessions.get(token);
  if (!session) return false;
  if (Date.now() - session.lastActivity > SESSION_TTL) {
    adminSessions.delete(token);
    return false;
  }
  session.lastActivity = Date.now();
  return true;
}

// Cleanup expired sessions every minute
setInterval(() => {
  const now = Date.now();
  for (const [token, s] of adminSessions) {
    if (now - s.lastActivity > SESSION_TTL) adminSessions.delete(token);
  }
}, 60_000);

// ─── Rate limiting (in-memory) ───────────────────────────────
const rateBuckets = new Map();  // key → { count, resetAt }

function rateLimit(key, maxRequests, windowMs) {
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    rateBuckets.set(key, bucket);
  }
  bucket.count++;
  return bucket.count > maxRequests;
}

// Cleanup stale buckets every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of rateBuckets) {
    if (now > b.resetAt) rateBuckets.delete(key);
  }
}, 5 * 60_000);

// ─── Brute-force protection for admin login ──────────────────
const loginAttempts = new Map();  // ip → { count, lockedUntil }
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS   = 15 * 60 * 1000; // 15 min lockout
const LOGIN_WINDOW_MS    = 5  * 60 * 1000; // 5 min window

// ─── Version gating (freemium model) ─────────────────────────
async function readAccessConfig() { return readJson('access-config.json', { gatedFromVersion: '1.0.5', freeOverrides: [], gatedOverrides: [] }); }
async function writeAccessConfig(config) { return writeJson('access-config.json', config); }

/** Compare two semver strings. Returns -1, 0, or 1. */
function compareSemver(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] || 0, vb = pb[i] || 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

async function isVersionGated(tag) {
  if (!tag) return false;
  const config = await readAccessConfig();
  const ver = tag.replace(/^v/, '');
  // Explicit overrides take priority
  if (config.freeOverrides?.includes(tag) || config.freeOverrides?.includes(ver)) return false;
  if (config.gatedOverrides?.includes(tag) || config.gatedOverrides?.includes(ver)) return true;
  // Threshold comparison
  return compareSemver(ver, config.gatedFromVersion) >= 0;
}

/** Create a signed download token (HMAC-SHA256). */
function createDownloadToken(email, assetId, expiresAt) {
  const payload = `${email}:${assetId}:${expiresAt}`;
  const hmac = crypto.createHmac('sha256', ACCESS_TOKEN_SECRET).update(payload).digest('hex');
  return hmac;
}

/** Verify a download token. */
function verifyDownloadToken(email, assetId, expiresAt, token) {
  if (Date.now() > Number(expiresAt)) return false;
  const expected = createDownloadToken(email, assetId, expiresAt);
  if (expected.length !== token.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}

/** Find which release tag an asset belongs to (from cache). */
function findReleaseTagForAsset(assetId) {
  if (!releasesCache.data) return null;
  for (const r of releasesCache.data) {
    if (r.assets.some(a => String(a.id) === String(assetId))) return r.tag;
  }
  return null;
}

// ─── In-memory cache ─────────────────────────────────────────
let releasesCache = { data: null, fetchedAt: 0 };

const GITHUB_API_TIMEOUT_MS = 15_000; // 15 seconds

function githubFetch(apiPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: apiPath,
      method: 'GET',
      timeout: GITHUB_API_TIMEOUT_MS,
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
    req.on('timeout', () => { req.destroy(); reject(new Error('GitHub API request timed out')); });
    req.on('error', reject);
    req.end();
  });
}

const MAX_STREAM_REDIRECTS = 5;

function githubStream(url, res, _redirectCount = 0) {
  if (_redirectCount > MAX_STREAM_REDIRECTS) {
    return res.status(502).json({ error: 'Too many redirects' });
  }
  const parsed = new URL(url);
  const options = {
    hostname: parsed.hostname,
    path: parsed.pathname + parsed.search,
    method: 'GET',
    timeout: 30_000,
    headers: {
      'User-Agent': 'perf-agent-website',
      'Accept': 'application/octet-stream',
      ...(GITHUB_TOKEN && { 'Authorization': `token ${GITHUB_TOKEN}` }),
    },
  };

  const req = https.request(options, (upstream) => {
    // GitHub returns 302 redirect for asset downloads
    if (upstream.statusCode === 302 || upstream.statusCode === 301) {
      return githubStream(upstream.headers.location, res, _redirectCount + 1);
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
  req.on('timeout', () => { req.destroy(); res.status(504).json({ error: 'Download timed out' }); });
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

// ─── Security headers (helmet + CSP) ─────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],  // inline onclick handlers in HTML
      scriptSrcAttr: ["'unsafe-inline'"],  // allow inline event handlers (onclick, etc.)
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://perfagentdemo.blob.core.windows.net"],
      mediaSrc: ["'self'", "https://perfagentdemo.blob.core.windows.net"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,  // allow loading external fonts/images
  hsts: { maxAge: 31536000, includeSubDomains: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// ─── Helper: get client IP (uses trust proxy setting) ────────
function getClientIp(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

// ─── Global rate limiter (per IP) ────────────────────────────
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) return next();
  const ip = getClientIp(req);
  if (rateLimit(`global:${ip}`, 100, 60_000)) {
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }
  next();
});

// ─── Body parser ─────────────────────────────────────────────
app.use(express.json({ limit: '16kb' }));

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

// ─── API: All releases (with gating info) ───────────────────
app.get('/api/releases', async (req, res) => {
  try {
    const releases = await fetchReleases();
    const withGating = await Promise.all(releases.map(async r => ({ ...r, gated: await isVersionGated(r.tag) })));
    res.json(withGating);
  } catch (err) {
    console.error('Failed to fetch releases:', err.message);
    res.status(502).json({ error: 'Failed to fetch releases from GitHub' });
  }
});

// ─── API: Latest release (with gating info) ─────────────────
app.get('/api/releases/latest', async (req, res) => {
  try {
    const releases = await fetchReleases();
    const latest = releases.find((r) => !r.prerelease && !r.draft) || releases[0];
    if (!latest) return res.status(404).json({ error: 'No releases found' });
    res.json({ ...latest, gated: await isVersionGated(latest.tag) });
  } catch (err) {
    console.error('Failed to fetch latest release:', err.message);
    res.status(502).json({ error: 'Failed to fetch latest release' });
  }
});

// ─── API: Download asset (proxy with gating enforcement) ─────
app.get('/api/download/:assetId', async (req, res) => {
  const assetId = req.params.assetId;

  // Validate assetId is numeric to prevent path traversal
  if (!/^\d+$/.test(assetId)) {
    return res.status(400).json({ error: 'Invalid asset ID' });
  }

  // Ensure release cache is populated so we can check gating
  try { await fetchReleases(); } catch { /* proceed — cache may exist */ }

  const releaseTag = findReleaseTagForAsset(assetId);
  if (releaseTag && await isVersionGated(releaseTag)) {
    // Gated version — require a valid signed download token
    const { token, email, expires } = req.query;
    if (!token || !email || !expires) {
      return res.status(403).json({
        error: 'This version requires access approval.',
        gated: true,
        version: releaseTag,
        request_access_url: '/#early-access'
      });
    }
    if (!verifyDownloadToken(email, assetId, expires, token)) {
      return res.status(403).json({ error: 'Invalid or expired download link.' });
    }

    // Single-use: atomic check-and-mark to prevent race conditions
    const dlKey = `${email.toLowerCase()}::${assetId}`;
    const alreadyUsed = await markDownloadUsed(dlKey, email.toLowerCase(), assetId, releaseTag);
    if (alreadyUsed) {
      return res.status(403).json({
        error: 'This download link has already been used. Each link is single-use.',
        already_used: true,
        used_at: alreadyUsed.used_at
      });
    }

    console.log(`[DOWNLOAD] Gated download approved (single-use): ${releaseTag} asset ${assetId} for ${email}`);
  }

  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/assets/${assetId}`;
  githubStream(url, res);
});

// ─── API: Access config (admin) ──────────────────────────────
app.get('/api/admin/access-config', async (req, res) => {
  if (!validateSession(req)) return res.status(401).json({ error: 'Unauthorized' });
  res.json(await readAccessConfig());
});

app.put('/api/admin/access-config', async (req, res) => {
  if (!validateSession(req)) return res.status(401).json({ error: 'Unauthorized' });
  const { gatedFromVersion, freeOverrides, gatedOverrides } = req.body || {};
  if (!gatedFromVersion || !/^\d+\.\d+\.\d+$/.test(gatedFromVersion.replace(/^v/, ''))) {
    return res.status(400).json({ error: 'Invalid gatedFromVersion (must be semver like 1.0.5)' });
  }
  const config = {
    gatedFromVersion: gatedFromVersion.replace(/^v/, ''),
    freeOverrides: Array.isArray(freeOverrides) ? freeOverrides.map(String).slice(0, 50) : [],
    gatedOverrides: Array.isArray(gatedOverrides) ? gatedOverrides.map(String).slice(0, 50) : [],
  };
  await writeAccessConfig(config);
  console.log(`[ADMIN] Access config updated: gated from ${config.gatedFromVersion}`);
  res.json({ ok: true, config });
});

// ─── API: Generate download link (admin) ─────────────────────
app.post('/api/admin/generate-download-link', async (req, res) => {
  if (!validateSession(req)) return res.status(401).json({ error: 'Unauthorized' });
  const { email, version, platform } = req.body || {};
  if (!email || !version) {
    return res.status(400).json({ error: 'email and version are required' });
  }

  try {
    const releases = await fetchReleases();
    const release = releases.find(r => r.tag === version || r.tag === `v${version}`);
    if (!release || !release.assets.length) {
      return res.status(404).json({ error: 'Release or assets not found' });
    }

    const expiresAt = Date.now() + DOWNLOAD_LINK_TTL;
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    // Filter assets to match the user's requested platform
    let matchedAssets = release.assets;
    if (platform) {
      const p = platform.toLowerCase();
      const platformKw = []; // OR — at least one must match
      const archKw = [];     // OR — at least one must match
      if (p.includes('macos') || p.includes('mac'))   platformKw.push('darwin', 'macos');
      if (p.includes('windows') || p.includes('win'))  platformKw.push('win32', 'windows');
      if (p.includes('linux'))                         platformKw.push('linux');
      if (p.includes('arm64') || p.includes('apple silicon')) archKw.push('arm64');
      if (p.includes('x64') || p.includes('intel'))    archKw.push('x64');
      if (platformKw.length || archKw.length) {
        const filtered = release.assets.filter(a => {
          const name = a.name.toLowerCase();
          const platOk = !platformKw.length || platformKw.some(k => name.includes(k));
          const archOk = !archKw.length || archKw.some(k => name.includes(k));
          return platOk && archOk;
        });
        if (filtered.length) matchedAssets = filtered;
      }
    }

    const links = matchedAssets.map(asset => {
      const token = createDownloadToken(email, asset.id, expiresAt);
      return {
        name: asset.name,
        size: asset.size,
        url: `${baseUrl}/api/download/${asset.id}?email=${encodeURIComponent(email)}&expires=${expiresAt}&token=${token}`,
      };
    });

    // Persist approval so user can self-serve via check-approval
    const approvals = await readApprovals();
    // Remove any old approval for same email+version+platform
    const filtered = approvals.filter(a => !(a.email === email && a.version === release.tag && (a.platform || '') === (platform || '')));
    filtered.push({ email, version: release.tag, platform: platform || '', expires_at: expiresAt, links, approved_at: Date.now() });
    await writeApprovals(filtered);

    console.log(`[ADMIN] Generated ${links.length} download links for ${email} — ${version}`);
    res.json({ ok: true, version: release.tag, email, expires_at: new Date(expiresAt).toISOString(), links });
  } catch (err) {
    console.error('[ADMIN] Failed to generate links:', err.message);
    res.status(500).json({ error: 'Failed to generate download links' });
  }
});

// ─── API: Reject a submission (admin) ─────────────────────────
app.post('/api/admin/reject-submission', async (req, res) => {
  if (!validateSession(req)) return res.status(401).json({ error: 'Unauthorized' });
  const { email, version, platform, reason } = req.body || {};
  if (!email || !version) {
    return res.status(400).json({ error: 'email and version are required' });
  }
  const rejections = await readRejections();
  // Remove any old rejection for same email+version+platform
  const filtered = rejections.filter(r => !(r.email.toLowerCase() === email.toLowerCase() && r.version === version && (r.platform || '') === (platform || '')));
  filtered.push({
    email: email.toLowerCase(),
    version,
    platform: platform || '',
    reason: typeof reason === 'string' ? reason.slice(0, 500) : '',
    rejected_at: Date.now()
  });
  await writeRejections(filtered);

  // Also remove from approvals if previously approved
  const approvals = await readApprovals();
  const cleanedApprovals = approvals.filter(a => !(a.email.toLowerCase() === email.toLowerCase() && a.version === version && (a.platform || '') === (platform || '')));
  if (cleanedApprovals.length !== approvals.length) await writeApprovals(cleanedApprovals);

  console.log(`[ADMIN] Rejected ${email} for ${version}: ${reason || '(no reason)'}`);
  res.json({ ok: true });
});

// ─── API: Delete a submission (admin) ────────────────────────
app.delete('/api/admin/submission/:id', async (req, res) => {
  if (!validateSession(req)) return res.status(401).json({ error: 'Unauthorized' });
  const id = req.params.id;
  const submissions = await readSubmissions();
  const idx = submissions.findIndex(s => s.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Submission not found' });
  const removed = submissions.splice(idx, 1)[0];
  await writeSubmissions(submissions);

  // Track deletion so user sees a message when checking status
  const deletions = await readDeletions();
  deletions.push({
    email: (removed.email || '').toLowerCase(),
    version: removed.version || '',
    platform: removed.platform || '',
    deleted_at: Date.now()
  });
  await writeDeletions(deletions);

  // Also remove any approval for this email+version+platform so download links stop working
  const approvals = await readApprovals();
  const cleanedApprovals = approvals.filter(a => !(a.email.toLowerCase() === (removed.email || '').toLowerCase() && a.version === removed.version && (a.platform || '') === (removed.platform || '')));
  if (cleanedApprovals.length !== approvals.length) await writeApprovals(cleanedApprovals);

  console.log(`[ADMIN] Deleted submission ${id} (${removed.email})`);
  res.json({ ok: true });
});

// ─── API: Check approval status (public, rate-limited) ──────
app.post('/api/check-approval', async (req, res) => {
  const ip = getClientIp(req);
  // Rate-limit to prevent email enumeration
  if (rateLimit(`check-approval:${ip}`, 10, 60_000)) {
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }

  const { email } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  const emailLower = email.toLowerCase();
  const approvals = await readApprovals();
  const rejections = await readRejections();
  const deletions = await readDeletions();
  const now = Date.now();

  // Find all non-expired approvals for this email
  const userApprovals = approvals.filter(a =>
    a.email.toLowerCase() === emailLower && a.expires_at > now
  );

  // Find rejections for this email
  const userRejections = rejections.filter(r =>
    r.email.toLowerCase() === emailLower
  );

  // Find deletions for this email
  const userDeletions = deletions.filter(d =>
    d.email.toLowerCase() === emailLower
  );

  if (!userApprovals.length && !userRejections.length && !userDeletions.length) {
    return res.json({ approved: false, rejected: false, deleted: false, message: 'No records found for this email. Your request may still be under review.' });
  }

  const downloads = await readDownloads();
  const approvalResults = userApprovals.map(a => ({
    version: a.version,
    approved_at: a.approved_at ? new Date(a.approved_at).toISOString() : null,
    expires_at: new Date(a.expires_at).toISOString(),
    links: (a.links || []).map(l => {
      // Extract assetId from the link URL to check usage
      const assetMatch = l.url && l.url.match(/\/api\/download\/(\d+)/);
      const aid = assetMatch ? assetMatch[1] : null;
      const dlKey = `${emailLower}::${aid}`;
      const used = aid ? !!downloads[dlKey] : false;
      return { ...l, used, used_at: used ? downloads[dlKey].used_at : null };
    })
  }));

  const rejectionResults = userRejections.map(r => ({
    version: r.version,
    reason: r.reason || '',
    rejected_at: new Date(r.rejected_at).toISOString()
  }));

  const deletionResults = userDeletions.map(d => ({
    version: d.version,
    deleted_at: new Date(d.deleted_at).toISOString()
  }));

  res.json({
    approved: userApprovals.length > 0,
    rejected: userRejections.length > 0,
    deleted: userDeletions.length > 0,
    approvals: approvalResults,
    rejections: rejectionResults,
    deletions: deletionResults
  });
});

// ─── API: Admin data viewer (all JSON files) ─────────────────
app.get('/api/admin/data/:file', async (req, res) => {
  if (!validateSession(req)) return res.status(401).json({ error: 'Unauthorized' });
  const allowed = {
    submissions: 'submissions.json',
    approvals: 'approvals.json',
    rejections: 'rejections.json',
    deletions: 'deletions.json',
    downloads: 'downloads.json',
    'access-config': 'access-config.json',
  };
  const blobName = allowed[req.params.file];
  if (!blobName) return res.status(404).json({ error: 'Unknown data file' });
  try {
    const defaultVal = blobName === 'downloads.json' ? {} : [];
    const data = await readJson(blobName, defaultVal);
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Failed to read file' });
  }
});

// ─── Health check (minimal — no sensitive info) ─────────────
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// ─── Admin auth endpoints ────────────────────────────────────
app.post('/api/admin/login', (req, res) => {
  const ip = getClientIp(req);

  // Brute-force check
  const attempts = loginAttempts.get(ip);
  if (attempts && attempts.lockedUntil && Date.now() < attempts.lockedUntil) {
    const retryAfter = Math.ceil((attempts.lockedUntil - Date.now()) / 1000);
    res.setHeader('Retry-After', retryAfter);
    return res.status(429).json({ error: 'Too many failed attempts. Try again later.', retry_after: retryAfter });
  }

  // Rate limit login endpoint specifically: 10 per minute per IP
  if (rateLimit(`login:${ip}`, 10, 60_000)) {
    return res.status(429).json({ error: 'Too many requests. Slow down.' });
  }

  const { passphrase } = req.body || {};
  if (typeof passphrase !== 'string' || passphrase.length > 200) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  // Constant-time comparison to prevent timing attacks
  const input = Buffer.from(passphrase);
  const secret = Buffer.from(ADMIN_PASS);
  const valid = input.length === secret.length && crypto.timingSafeEqual(input, secret);

  if (!valid) {
    // Track failed attempts
    const record = loginAttempts.get(ip) || { count: 0, firstAttempt: Date.now(), lockedUntil: null };
    if (Date.now() - record.firstAttempt > LOGIN_WINDOW_MS) {
      record.count = 0;
      record.firstAttempt = Date.now();
    }
    record.count++;
    if (record.count >= MAX_LOGIN_ATTEMPTS) {
      record.lockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
      console.warn(`[ADMIN] IP ${ip} locked out after ${record.count} failed login attempts`);
    }
    loginAttempts.set(ip, record);
    // Generic error message — don't reveal if passphrase is close
    return res.status(401).json({ error: 'Invalid passphrase' });
  }

  // Success — clear failed attempts and create session
  loginAttempts.delete(ip);
  const token = createSession();
  console.log(`[ADMIN] Login from ${ip}`);
  res.json({ ok: true, token, expires_in: SESSION_TTL / 1000 });
});

app.post('/api/admin/logout', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token) adminSessions.delete(token);
  res.json({ ok: true });
});

app.get('/api/admin/verify', (req, res) => {
  if (!validateSession(req)) return res.status(401).json({ error: 'Session expired' });
  res.json({ ok: true });
});

// ─── Interest / Early Access form ────────────────────────────
async function readSubmissions() { return readJson('submissions.json', []); }
async function writeSubmissions(list) { return writeJson('submissions.json', list); }

function sanitize(str, maxLen = 500) {
  if (typeof str !== 'string') return '';
  return str
    .slice(0, maxLen)
    .replace(/[&<>"'`\/]/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
      "'": '&#x27;', '`': '&#x60;', '/': '&#x2F;',
    }[ch]));
}

app.post('/api/interest', async (req, res) => {
  const ip = getClientIp(req);
  // 5 submissions per IP per hour
  if (rateLimit(`interest:${ip}`, 5, 60 * 60_000)) {
    return res.status(429).json({ error: 'Too many submissions. Try again later.' });
  }
  const { name, email, organization, role, version, platform, message } = req.body || {};
  if (!name || !email || !version) {
    return res.status(400).json({ error: 'name, email, and version are required' });
  }
  // Validate email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  // Validate version looks like a GitHub release tag (e.g. v1.0.0, v2.3.1-beta)
  if (!/^v?\d+\.\d+\.\d+[\w.\-]*$/.test(version)) {
    return res.status(400).json({ error: 'Invalid version selection' });
  }
  const entry = {
    id: crypto.randomUUID(),
    name: sanitize(name, 100),
    email: sanitize(email, 150),
    organization: sanitize(organization, 150),
    role: sanitize(role, 50),
    version: sanitize(version, 50),
    platform: sanitize(platform, 30),
    message: sanitize(message, 1000),
    submitted_at: new Date().toISOString(),
  };
  const list = await readSubmissions();
  list.push(entry);
  await writeSubmissions(list);
  console.log(`[INTEREST] ${entry.email} — ${entry.version} (${entry.platform || 'n/a'})`);
  res.json({ ok: true, id: entry.id });
});

// Admin-protected data endpoints (Bearer token required)
app.get('/api/interest', async (req, res) => {
  if (!validateSession(req)) return res.status(401).json({ error: 'Unauthorized' });
  res.json(await readSubmissions());
});

app.get('/api/interest/stats', async (req, res) => {
  if (!validateSession(req)) return res.status(401).json({ error: 'Unauthorized' });
  const list = await readSubmissions();
  const byVersion = {}; const byRole = {}; const orgs = new Set();
  list.forEach((s) => {
    byVersion[s.version] = (byVersion[s.version] || 0) + 1;
    if (s.role) byRole[s.role] = (byRole[s.role] || 0) + 1;
    if (s.organization) orgs.add(s.organization);
  });
  res.json({ total: list.length, unique_orgs: orgs.size, by_version: byVersion, by_role: byRole });
});

// ─── Perf test endpoint (reduced info disclosure) ───────────
let perfHitCount = 0;
app.get('/api/perf-test', (req, res) => {
  perfHitCount++;
  const start = process.hrtime.bigint();

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
    };

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
