/* ========================================
   Performance Agent Website — Script
   ======================================== */

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initTabs();
  initScrollEffects();
  initReleases();
  initVideoPlayer();
  initReadinessChecker();
  initInterestForm();
  initApprovalChecker();
});

// --- Navigation ---
function initNavigation() {
  const nav = document.getElementById('nav');
  const toggle = document.getElementById('nav-toggle');
  const links = document.getElementById('nav-links');

  // Scroll effect
  let lastScroll = 0;
  window.addEventListener('scroll', () => {
    const scrollY = window.scrollY;
    nav.classList.toggle('scrolled', scrollY > 20);
    lastScroll = scrollY;
  }, { passive: true });

  // Mobile toggle
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      links.classList.toggle('open');
      toggle.classList.toggle('active');
    });

    // Close on link click
    links.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        links.classList.remove('open');
        toggle.classList.remove('active');
      });
    });
  }

  // Smooth scroll for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      const target = document.querySelector(anchor.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });
}

// --- Tab Switching ---
function initTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.tab;

      // Deactivate all
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      // Activate target
      btn.classList.add('active');
      const target = document.getElementById(targetId);
      if (target) {
        target.classList.add('active');
      }
    });
  });
}

// --- Scroll Effects (Intersection Observer) ---
function initScrollEffects() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  // Observe cards and sections
  document.querySelectorAll(
    '.feature-card, .download-card, .install-card, .tool-category, ' +
    '.pipeline-item, .tutorial-step, .faq-item, .security-item, .reference-table, ' +
    '.report-showcase-card'
  ).forEach(el => {
    el.classList.add('fade-in');
    observer.observe(el);
  });
}

// --- Copy Command ---
function copyCommand(btn) {
  const codeEl = btn.closest('.hero-install')?.querySelector('code');
  if (!codeEl) return;

  const text = codeEl.textContent.trim();
  navigator.clipboard.writeText(text).then(() => {
    btn.classList.add('copied');
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = originalHTML;
    }, 2000);
  }).catch(() => {
    // Fallback
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  });
}



// --- Prefill early-access form & scroll to it ---
function prefillAccessForm(version) {
  const section = document.getElementById('early-access');
  if (section) section.scrollIntoView({ behavior: 'smooth' });
  // Wait for scroll + ensure dropdown is populated, then select the version
  setTimeout(() => {
    const select = document.getElementById('form-version');
    if (select) {
      for (const opt of select.options) {
        if (opt.value === version) { select.value = version; break; }
      }
    }
  }, 400);
}

// --- Check Approval Status ---
const DL_ICON_SM = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

async function checkApproval() {
  const input = document.getElementById('approval-email');
  const resultEl = document.getElementById('approval-result');
  const btn = document.getElementById('approval-check-btn');
  const email = (input.value || '').trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    input.style.borderColor = '#ef4444';
    return;
  }
  input.style.borderColor = '';

  btn.disabled = true;
  btn.textContent = 'Checking...';
  resultEl.style.display = 'none';

  try {
    const res = await fetch('/api/check-approval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();

    // ── Build active download cards (approvals with valid links) ──
    let activeHtml = '';
    if (data.approved && data.approvals && data.approvals.length > 0) {
      activeHtml = data.approvals.map(a => {
        const expiryDate = new Date(a.expires_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const assetsHtml = a.links.map(l =>
          l.used
            ? `<div class="approval-asset">
                <span class="approval-asset__name">${escapeHtmlInline(l.name)}</span>
                <span class="dl-used-badge">✓ Downloaded</span>
              </div>`
            : `<div class="approval-asset">
                <span class="approval-asset__name">${escapeHtmlInline(l.name)}</span>
                <a href="${escapeHtmlInline(l.url)}" class="dl-btn dl-btn--sm">${DL_ICON_SM} Download</a>
              </div>`
        ).join('');
        return `<div class="approval-version-card">
          <div class="approval-version-card__header">
            <span class="approval-version-card__tag">${escapeHtmlInline(a.version)}</span>
            <span class="approval-version-card__expiry">Expires: ${expiryDate}</span>
          </div>
          ${assetsHtml}
        </div>`;
      }).join('');
    }

    // ── Build unified history timeline ──
    const events = [];
    if (data.approvals) data.approvals.forEach(a => {
      events.push({ type: 'approved', version: a.version, date: a.approved_at || new Date(a.expires_at).toISOString() });
    });
    if (data.rejections) data.rejections.forEach(r => events.push({ type: 'rejected', version: r.version, date: r.rejected_at, reason: r.reason }));
    if (data.deletions) data.deletions.forEach(d => events.push({ type: 'deleted', version: d.version, date: d.deleted_at }));
    events.sort((a, b) => new Date(b.date) - new Date(a.date));

    let historyHtml = '';
    if (events.length > 0) {
      const timelineItems = events.map(e => {
        const evDate = new Date(e.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        if (e.type === 'approved') {
          return `<div class="timeline-item timeline-item--approved">
            <div class="timeline-dot timeline-dot--approved"></div>
            <div class="timeline-content">
              <span class="timeline-badge timeline-badge--approved">Approved</span>
              <span class="timeline-version">${escapeHtmlInline(e.version)}</span>
              <span class="timeline-date">${evDate}</span>
            </div>
          </div>`;
        } else if (e.type === 'rejected') {
          return `<div class="timeline-item timeline-item--rejected">
            <div class="timeline-dot timeline-dot--rejected"></div>
            <div class="timeline-content">
              <span class="timeline-badge timeline-badge--rejected">Rejected</span>
              <span class="timeline-version">${escapeHtmlInline(e.version)}</span>
              <span class="timeline-date">${evDate}</span>
              ${e.reason ? `<span class="timeline-reason">Reason: ${escapeHtmlInline(e.reason)}</span>` : ''}
            </div>
          </div>`;
        } else {
          return `<div class="timeline-item timeline-item--deleted">
            <div class="timeline-dot timeline-dot--deleted"></div>
            <div class="timeline-content">
              <span class="timeline-badge timeline-badge--deleted">Removed</span>
              <span class="timeline-version">${escapeHtmlInline(e.version)}</span>
              <span class="timeline-date">${evDate}</span>
            </div>
          </div>`;
        }
      }).join('');
      historyHtml = `<div class="status-history">
        <div class="status-history__header" onclick="this.parentElement.classList.toggle('open')">
          <span>📋 History (${events.length} event${events.length > 1 ? 's' : ''})</span>
          <span class="status-history__toggle">▸</span>
        </div>
        <div class="status-history__timeline">${timelineItems}</div>
      </div>`;
    }

    // ── Render combined output ──
    if (!activeHtml && events.length === 0) {
      resultEl.className = 'approval-result approval-result--not-found';
      resultEl.innerHTML = `<p>No active approvals found for <strong>${escapeHtmlInline(email)}</strong>.</p><p style="margin-top:8px;">Haven\u2019t requested yet? <a href="#early-access">Request Early Access</a></p>`;
    } else if (!activeHtml) {
      resultEl.className = 'approval-result';
      resultEl.innerHTML = `<div class="approval-version-card" style="border-color:var(--border-color);"><p style="margin:0;font-size:0.9rem;color:var(--text-secondary);">No active download links. Your previous request was processed — see history below.</p></div>` + historyHtml;
    } else {
      resultEl.className = 'approval-result';
      resultEl.innerHTML = activeHtml + historyHtml;
    }
    resultEl.style.display = 'block';
  } catch (err) {
    resultEl.className = 'approval-result approval-result--not-found';
    resultEl.innerHTML = '<p>Something went wrong. Please try again.</p>';
    resultEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Check Status';
  }
}

function escapeHtmlInline(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function initApprovalChecker() {
  const input = document.getElementById('approval-email');
  if (input) {
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') checkApproval(); });
  }
}

// --- Releases from GitHub (proxied via server) ---
function initReleases() {
  loadLatestRelease();
  loadAllReleases();
}

function formatBytes(bytes) {
  if (!bytes) return '—';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function timeAgo(dateStr) {
  const now = new Date();
  const d = new Date(dateStr);
  const days = Math.floor((now - d) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

const DL_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
const LOCK_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

function detectPlatform(filename) {
  const f = filename.toLowerCase();
  if (f.includes('win32') || f.includes('windows')) return { os: 'Windows', icon: 'windows' };
  if (f.includes('darwin') || f.includes('macos'))   return { os: 'macOS', icon: 'macos' };
  if (f.includes('linux'))                           return { os: 'Linux', icon: 'linux' };
  return { os: '', icon: '' };
}

function detectArch(filename) {
  const f = filename.toLowerCase();
  if (f.includes('arm64') || f.includes('aarch64')) return 'ARM64';
  if (f.includes('x64') || f.includes('amd64'))     return 'x64';
  if (f.includes('x86') || f.includes('ia32'))       return 'x86';
  return '';
}

async function loadLatestRelease() {
  const tbody = document.getElementById('dl-table-body');
  const badge = document.getElementById('latest-release-badge');

  try {
    console.log('[releases] Fetching latest release...');
    const res = await fetch('/api/releases/latest');
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`API error ${res.status}: ${errText}`);
    }
    const release = await res.json();
    console.log('[releases] Latest release:', release.tag, '—', (release.assets || []).length, 'assets');

    // Update badge
    if (badge) {
      badge.querySelector('.release-badge__tag').textContent = release.tag || release.name;
      badge.querySelector('.release-badge__date').textContent = `Released ${formatDate(release.published_at)}`;
      badge.style.display = 'flex';
    }

    // Populate downloads table
    if (!release.assets || release.assets.length === 0) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="dl-loading">No assets available in latest release</td></tr>';
      return;
    }

    if (tbody) {
      tbody.innerHTML = release.assets.map(asset => {
        const platform = detectPlatform(asset.name);
        const arch = detectArch(asset.name);
        const label = [platform.os, arch].filter(Boolean).join(' ');
        const gated = release.gated;

        const actionBtn = gated
          ? `<a href="#early-access" class="dl-btn dl-btn--gated" onclick="prefillAccessForm('${release.tag || ''}')">${LOCK_ICON} Request Access</a>`
          : `<a href="/api/download/${asset.id}" class="dl-btn">${DL_ICON} Download</a>`;

        return `
          <tr class="dl-row">
            <td class="dl-filename">
              <code>${asset.name}</code>
              ${label ? `<span class="dl-platform-hint">${label}</span>` : ''}
            </td>
            <td class="dl-size">${formatBytes(asset.size)}</td>
            <td class="dl-downloads">${(asset.download_count || 0).toLocaleString()}</td>
            <td>${actionBtn}</td>
          </tr>`;
      }).join('');
      console.log('[releases] Downloads table populated with', release.assets.length, 'rows');
    }

  } catch (err) {
    console.error('[releases] Failed to load latest release:', err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="dl-loading dl-error">Could not load releases — ${err.message}. <a href="javascript:location.reload()">Retry</a></td></tr>`;
  }
}

function simpleMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    .replace(/\n{2,}/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');
}

async function loadAllReleases() {
  const container = document.getElementById('releases-list');
  if (!container) return;

  try {
    console.log('[releases] Fetching all releases...');
    const res = await fetch('/api/releases');
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`API error ${res.status}: ${errText}`);
    }
    const releases = await res.json();
    console.log('[releases] Got', releases.length, 'releases');

    if (!releases.length) {
      container.innerHTML = '<p class="dl-loading">No releases found.</p>';
      return;
    }

    container.innerHTML = releases.map((release, idx) => {
      const isLatest = idx === 0;
      const gated = release.gated;
      const assetsHtml = (release.assets || []).map(a => {
        const actionBtn = gated
          ? `<a href="#early-access" class="dl-btn dl-btn--sm dl-btn--gated" onclick="prefillAccessForm('${release.tag || ''}')">${LOCK_ICON}</a>`
          : `<a href="/api/download/${a.id}" class="dl-btn dl-btn--sm">${DL_ICON}</a>`;
        return `
        <div class="release-asset">
          <span class="release-asset__name">${a.name}</span>
          <span class="release-asset__size">${formatBytes(a.size)}</span>
          <span class="release-asset__count">${(a.download_count || 0).toLocaleString()} downloads</span>
          ${actionBtn}
        </div>
      `;
      }).join('');

      return `
        <details class="release-card" ${isLatest ? 'open' : ''}>
          <summary class="release-card__header">
            <div class="release-card__title">
              <span class="release-card__tag">${release.tag || release.name}</span>
              ${isLatest ? '<span class="release-card__badge">Latest</span>' : ''}
              ${release.prerelease ? '<span class="release-card__badge release-card__badge--pre">Pre-release</span>' : ''}
              ${gated ? '<span class="release-card__badge release-card__badge--gated">Access Required</span>' : ''}
            </div>
            <span class="release-card__date">${timeAgo(release.published_at)}</span>
          </summary>
          <div class="release-card__body">
            ${release.body ? `<div class="release-card__notes">${simpleMarkdown(release.body)}</div>` : ''}
            ${assetsHtml ? `<div class="release-card__assets"><h4>Assets</h4>${assetsHtml}</div>` : '<p class="dl-loading">No assets</p>'}
          </div>
        </details>
      `;
    }).join('');
    console.log('[releases] Release cards rendered');

  } catch (err) {
    console.error('[releases] Failed to load releases:', err);
    container.innerHTML = `<p class="dl-loading dl-error">Could not load release history — ${err.message}. <a href="javascript:location.reload()">Retry</a></p>`;
  }
}

// --- Fade-in animation CSS injection ---
(function injectFadeStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .fade-in {
      opacity: 0;
      transform: translateY(20px);
      transition: opacity 0.5s ease, transform 0.5s ease;
    }
    .fade-in.visible {
      opacity: 1;
      transform: translateY(0);
    }
  `;
  document.head.appendChild(style);
})();

// --- Video Player ---
function initVideoPlayer() {
  const video = document.getElementById('demo-video');
  const overlay = document.getElementById('video-overlay');
  if (!video || !overlay) return;

  let videoLoaded = false;

  function loadVideoSource() {
    if (videoLoaded) return;
    const src = video.dataset.src;
    if (src) {
      const source = document.createElement('source');
      source.src = src;
      source.type = 'video/mp4';
      video.appendChild(source);
      video.load();
    }
    videoLoaded = true;
  }

  // Start background download after page fully loads (images, styles, etc.)
  // Uses requestIdleCallback if available, otherwise a 2s delay after load
  window.addEventListener('load', () => {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => loadVideoSource(), { timeout: 3000 });
    } else {
      setTimeout(loadVideoSource, 2000);
    }
  });

  overlay.addEventListener('click', () => {
    // If user clicks before background load finishes, load immediately
    loadVideoSource();
    overlay.classList.add('hidden');
    video.play();
  });

  video.addEventListener('pause', () => {
    if (!video.ended) {
      overlay.classList.remove('hidden');
    }
  });

  video.addEventListener('ended', () => {
    overlay.classList.remove('hidden');
  });
}

/* ========================================
   Readiness Checker
   ======================================== */

function initReadinessChecker() {
  const boxes = document.querySelectorAll('.readiness-check input[type=checkbox]');
  if (!boxes.length) return;
  boxes.forEach(cb => cb.addEventListener('change', computeReadiness));
}

function resetReadinessCheck() {
  document.querySelectorAll('.readiness-check input[type=checkbox]').forEach(cb => { cb.checked = false; });
  computeReadiness();
}

function computeReadiness() {
  const boxes = document.querySelectorAll('.readiness-check input[type=checkbox]');
  const checked = new Set();
  let totalWeight = 0;
  let earnedWeight = 0;
  const catTotals = {};
  const catEarned = {};

  boxes.forEach(cb => {
    const tool = cb.dataset.tool;
    const weight = parseFloat(cb.dataset.weight) || 0;
    const cat = cb.dataset.category || 'other';
    totalWeight += weight;
    catTotals[cat] = (catTotals[cat] || 0) + weight;
    if (cb.checked) {
      checked.add(tool);
      earnedWeight += weight;
      catEarned[cat] = (catEarned[cat] || 0) + weight;
    }
  });

  // VS Code + Copilot Chat are hard prerequisites — nothing works without them
  const hasPrereqs = checked.has('vscode') && checked.has('copilot');
  const effectivePct = hasPrereqs
    ? (totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 0)
    : (checked.size > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 0);
  // Even if they check other tools, features are blocked without VS Code + Copilot
  const pct = effectivePct;

  // Update score ring
  const ring = document.getElementById('score-ring-fill');
  const circumference = 2 * Math.PI * 52; // r=52
  if (ring) ring.style.strokeDashoffset = circumference - (circumference * pct / 100);

  // Update score color
  if (ring) {
    if (!hasPrereqs) ring.style.stroke = '#f43f5e';
    else if (pct >= 80) ring.style.stroke = '#34d399';
    else if (pct >= 50) ring.style.stroke = '#fbbf24';
    else ring.style.stroke = '#818cf8';
  }

  // Update score text
  const scoreVal = document.getElementById('score-value');
  if (scoreVal) scoreVal.textContent = pct + '%';

  // Blocker banner
  let banner = document.getElementById('readiness-blocker');
  if (!hasPrereqs && checked.size > 0) {
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'readiness-blocker';
      banner.className = 'readiness-blocker';
      const scoreCard = document.querySelector('.readiness-score-card');
      if (scoreCard) scoreCard.parentNode.insertBefore(banner, scoreCard);
    }
    const missingList = [];
    if (!checked.has('vscode')) missingList.push('VS Code 1.95+');
    if (!checked.has('copilot')) missingList.push('GitHub Copilot Chat');
    banner.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' +
      '<div><strong>Blocked:</strong> ' + missingList.join(' & ') +
      ' required. Performance Agent is a VS Code MCP extension — it cannot function without these.</div>';
    banner.style.display = 'flex';
  } else if (banner) {
    banner.style.display = 'none';
  }

  // Update level label
  const lvl = document.getElementById('score-level');
  const desc = document.getElementById('score-desc');
  if (lvl && desc) {
    if (!hasPrereqs && checked.size > 0) {
      lvl.textContent = 'Prerequisites Missing';
      desc.textContent = 'VS Code and GitHub Copilot Chat are mandatory. Install them first — no features will work without them.';
    } else if (pct === 0) {
      lvl.textContent = 'Not Started';
      desc.textContent = 'Select the tools installed on your system to calculate your readiness score.';
    } else if (pct < 40) {
      lvl.textContent = 'Getting Started';
      desc.textContent = 'Install more tools to unlock additional features. Focus on Core Requirements first.';
    } else if (pct < 70) {
      lvl.textContent = 'Partially Ready';
      desc.textContent = 'You can run local tests. Install Azure CLI & Terraform for cloud testing.';
    } else if (pct < 90) {
      lvl.textContent = 'Almost There!';
      desc.textContent = 'You have most tools ready. A few optional tools will complete your setup.';
    } else {
      lvl.textContent = 'Fully Ready 🚀';
      desc.textContent = 'Your environment is fully configured for all Performance Agent features!';
    }
  }

  // Feature matrix — all blocked when prereqs missing
  const featureMap = {
    'feat-nfr':        ['nodejs'],
    'feat-jmx':        ['nodejs'],
    'feat-k6gen':      ['nodejs'],
    'feat-swagger':    ['nodejs'],
    'feat-codeswagger':['nodejs'],
    'feat-scenarios':  ['nodejs'],
    'feat-commit':     ['nodejs', 'git'],
    'feat-complexity': ['nodejs'],
    'feat-localjmeter':['jmeter', 'java'],
    'feat-sanity':     ['jmeter', 'java'],
    'feat-localk6':    ['k6'],
    'feat-provision':  ['azcli', 'azlogin', 'terraform'],
    'feat-cloud':      ['azcli', 'azlogin', 'terraform'],
    'feat-distributed':['azcli', 'azlogin', 'terraform'],
    'feat-byoi':       ['ssh'],
    'feat-metrics':    ['azcli', 'azlogin'],
    'feat-appinsights':['azcli', 'azlogin'],
    'feat-apim':       ['azcli', 'azlogin'],
    'feat-alt':        ['azcli', 'azlogin'],
    'feat-authconfig': ['nodejs'],
  };

  Object.entries(featureMap).forEach(([id, deps]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const ok = hasPrereqs && deps.every(d => checked.has(d));
    el.textContent = ok ? '✔' : '✖';
    el.classList.toggle('available', ok);
    el.closest('.feature-row').classList.toggle('available', ok);
  });

  // Category bars — zero out non-core categories when prerequisites missing
  ['core', 'local', 'cloud', 'analysis'].forEach(cat => {
    const bar = document.getElementById('cat-bar-' + cat);
    const lbl = document.getElementById('cat-pct-' + cat);
    const t = catTotals[cat] || 1;
    const e = catEarned[cat] || 0;
    const p = Math.round((e / t) * 100);
    if (bar) bar.style.width = p + '%';
    if (lbl) lbl.textContent = p + '%';
  });
}

// --- Lightbox ---
function closeWorkflowLightbox() {
  const lightbox = document.getElementById('workflow-lightbox');
  lightbox.classList.remove('active');
  document.body.style.overflow = '';
}

// Close lightbox on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeWorkflowLightbox();
});

// --- Image Lightbox (reuses workflow lightbox) ---
function openImageLightbox(container) {
  const lightbox = document.getElementById('workflow-lightbox');
  const titleEl = document.getElementById('lightbox-title');
  const bodyEl = document.getElementById('lightbox-body');

  const img = container.querySelector('img');
  if (!img) return;

  titleEl.textContent = img.alt || 'Image Preview';
  bodyEl.innerHTML = '';

  const clone = img.cloneNode(true);
  clone.style.maxWidth = '90vw';
  clone.style.maxHeight = '82vh';
  clone.style.width = 'auto';
  clone.style.height = 'auto';
  clone.style.borderRadius = '12px';
  clone.style.cursor = 'default';
  clone.style.objectFit = 'contain';
  bodyEl.appendChild(clone);

  lightbox.classList.add('active');
  document.body.style.overflow = 'hidden';
}

/* ========================================
   Interest / Early Access Form
   ======================================== */

// ---- CONFIGURATION ----
// Replace this URL with your Google Apps Script Web App URL after deploying the backend.
// See admin.html for setup instructions.
const FORM_ENDPOINT = '/api/interest';

function initInterestForm() {
  const form = document.getElementById('interest-form');
  if (!form) return;

  form.addEventListener('submit', handleInterestSubmit);
  loadVersionDropdown();
}

async function loadVersionDropdown() {
  const select = document.getElementById('form-version');
  if (!select) return;

  try {
    const res = await fetch('/api/releases');
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const releases = await res.json();

    select.innerHTML = '<option value="">Select a version</option>';
    releases.forEach((release, idx) => {
      const tag = release.tag || release.name;
      const label = tag + (idx === 0 ? ' (Latest)' : '') + (release.prerelease ? ' \u2014 Pre-release' : '');
      const opt = document.createElement('option');
      opt.value = tag;
      opt.textContent = label;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error('[interest-form] Failed to load versions:', err);
    select.innerHTML = '<option value="">Could not load versions</option>';
  }
}

async function handleInterestSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const btn = document.getElementById('form-submit-btn');

  // Clear previous invalid states
  form.querySelectorAll('.invalid').forEach(el => el.classList.remove('invalid'));

  // Gather values
  const name = form.elements.name.value.trim();
  const email = form.elements.email.value.trim();
  const organization = form.elements.organization.value.trim();
  const role = form.elements.role.value;
  const version = form.elements.version.value;
  const platform = form.elements.platform.value;
  const message = form.elements.message.value.trim();

  // Validate
  let valid = true;
  if (!name) { form.elements.name.classList.add('invalid'); valid = false; }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    form.elements.email.classList.add('invalid'); valid = false;
  }
  if (!organization) { form.elements.organization.classList.add('invalid'); valid = false; }
  if (!role) { form.elements.role.classList.add('invalid'); valid = false; }
  if (!version) {
    form.elements.version.classList.add('invalid');
    valid = false;
  }
  if (!platform) { form.elements.platform.classList.add('invalid'); valid = false; }
  if (!message) { form.elements.message.classList.add('invalid'); valid = false; }
  if (!valid) return;

  const payload = {
    name, email, organization, role, version, platform, message,
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent
  };

  btn.classList.add('loading');
  btn.disabled = true;

  try {
    const res = await fetch(FORM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(`Server error ${res.status}`);

    // Show success
    form.style.display = 'none';
    const success = document.getElementById('form-success');
    document.getElementById('form-success-email').textContent = email;
    success.style.display = 'block';

  } catch (err) {
    console.error('[interest-form] Submission failed:', err);
    // Fallback: save locally and show success anyway so user isn't stuck
    saveSubmissionLocally(payload);
    form.style.display = 'none';
    const success = document.getElementById('form-success');
    document.getElementById('form-success-email').textContent = email;
    success.style.display = 'block';
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

function saveSubmissionLocally(payload) {
  try {
    const key = 'interest_submissions';
    const existing = JSON.parse(localStorage.getItem(key) || '[]');
    existing.push(payload);
    localStorage.setItem(key, JSON.stringify(existing));
  } catch (_) { /* quota exceeded or private mode */ }
}

function resetInterestForm() {
  const form = document.getElementById('interest-form');
  const success = document.getElementById('form-success');
  if (form) { form.reset(); form.style.display = 'flex'; }
  if (success) success.style.display = 'none';
}


