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
    '.pipeline-item, .tutorial-step, .faq-item, .security-item, .reference-table'
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

        return `
          <tr class="dl-row">
            <td class="dl-filename">
              <code>${asset.name}</code>
              ${label ? `<span class="dl-platform-hint">${label}</span>` : ''}
            </td>
            <td class="dl-size">${formatBytes(asset.size)}</td>
            <td class="dl-downloads">${(asset.download_count || 0).toLocaleString()}</td>
            <td><a href="/api/download/${asset.id}" class="dl-btn">${DL_ICON} Download</a></td>
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
      const assetsHtml = (release.assets || []).map(a => `
        <div class="release-asset">
          <span class="release-asset__name">${a.name}</span>
          <span class="release-asset__size">${formatBytes(a.size)}</span>
          <span class="release-asset__count">${(a.download_count || 0).toLocaleString()} downloads</span>
          <a href="/api/download/${a.id}" class="dl-btn dl-btn--sm">${DL_ICON}</a>
        </div>
      `).join('');

      return `
        <details class="release-card" ${isLatest ? 'open' : ''}>
          <summary class="release-card__header">
            <div class="release-card__title">
              <span class="release-card__tag">${release.tag || release.name}</span>
              ${isLatest ? '<span class="release-card__badge">Latest</span>' : ''}
              ${release.prerelease ? '<span class="release-card__badge release-card__badge--pre">Pre-release</span>' : ''}
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
    'feat-commit':     ['nodejs', 'git'],
    'feat-complexity': ['nodejs'],
    'feat-localjmeter':['jmeter', 'java'],
    'feat-localk6':    ['k6'],
    'feat-provision':  ['azcli', 'azlogin', 'terraform'],
    'feat-cloud':      ['azcli', 'azlogin', 'terraform'],
    'feat-distributed':['azcli', 'azlogin', 'terraform'],
    'feat-byoi':       ['ssh'],
    'feat-metrics':    ['azcli', 'azlogin'],
    'feat-appinsights':['azcli', 'azlogin'],
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
