// ===== State =====
let state = {
  originalHtml: '',
  links: [],
  groups: {},
  warnings: [],
  stats: {},
  targetSelfCount: 0,
  previewReady: false
};

// ===== Template Syntax Protection =====
function protectTemplateSyntax(html) {
  const placeholders = [];
  const protectedHtml = html.replace(/\{\{(?:[^}]|\}(?!\}))*\}\}/g, (match) => {
    const idx = placeholders.length;
    placeholders.push(match);
    return `__SRLC_TPL_${idx}__`;
  });
  return { html: protectedHtml, placeholders };
}

function restoreTemplateSyntax(html, placeholders) {
  if (!placeholders || placeholders.length === 0) return html;
  return html.replace(/__SRLC_TPL_(\d+)__/g, (_, idx) => placeholders[parseInt(idx)]);
}

// ===== Utilities =====
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function showToast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

function normalizeUrl(href) {
  if (!href) return null;
  href = href.trim();
  if (!href || href === '#' || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return null;

  try {
    let path;
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//')) {
      const url = new URL(href, 'https://placeholder.com');
      path = url.pathname;
    } else {
      path = href.split('?')[0].split('#')[0];
    }
    path = path.toLowerCase();
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return path || href.toLowerCase();
  } catch {
    return href.toLowerCase().split('?')[0].split('#')[0];
  }
}

// ===== Link Classification =====
function isImageLink(a) {
  const imgs = a.querySelectorAll('img');
  if (imgs.length === 0) return false;
  const textContent = Array.from(a.childNodes).reduce((txt, node) => {
    if (node.nodeType === Node.TEXT_NODE) return txt + node.textContent.trim();
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'IMG' && !node.querySelector('img')) {
      return txt + node.textContent.trim();
    }
    return txt;
  }, '');
  return textContent.length === 0;
}

function isCtaLink(a) {
  const cls = (a.className || '').toLowerCase();
  const txt = (a.textContent || '').toLowerCase().trim();

  if (/\b(btn|button|cta|shop-now|buy-now|add-to-cart)\b/.test(cls)) return true;
  if (/^(shop|buy|order|add to cart|get it|check price|see price|view deal|view product|learn more)\b/i.test(txt)) return true;

  const parentCls = (a.parentElement?.className || '').toLowerCase();
  if (/\b(btn|button|cta|shop|call-to-action)\b/.test(parentCls)) return true;

  return false;
}

function isInHeading(el) {
  let cur = el;
  while (cur) {
    if (/^H[1-6]$/.test(cur.tagName)) return true;
    cur = cur.parentElement;
  }
  return false;
}

function isInternalLink(href, domain) {
  if (!href) return true;
  if (href.startsWith('/') || href.startsWith('#') || href.startsWith('?')) return true;
  if (!domain) return !href.startsWith('http');
  try {
    const url = new URL(href, 'https://placeholder.com');
    return url.hostname.includes(domain.toLowerCase());
  } catch { return true; }
}

function isExternalLink(href, domain) {
  if (!domain) return false;
  if (!href || href.startsWith('/') || href.startsWith('#')) return false;
  try {
    const url = new URL(href, 'https://placeholder.com');
    return !url.hostname.includes(domain.toLowerCase());
  } catch { return false; }
}

function getParentTag(el) {
  let cur = el.parentElement;
  while (cur) {
    const t = cur.tagName.toLowerCase();
    if (['p','li','td','th','h1','h2','h3','h4','h5','h6','blockquote','figcaption','dd','dt'].includes(t)) return t;
    cur = cur.parentElement;
  }
  return 'div';
}

function getContext(linkEl) {
  const parent = linkEl.parentElement;
  if (!parent) return '';
  const text = parent.textContent || '';
  const linkText = linkEl.textContent || '';
  const idx = text.indexOf(linkText);
  if (idx === -1) return text.slice(0, 80);
  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + linkText.length + 30);
  let ctx = text.slice(start, end).trim();
  if (start > 0) ctx = '...' + ctx;
  if (end < text.length) ctx += '...';
  return ctx;
}

// ===== Analysis Engine =====
function analyzeHtml(html) {
  const domain = document.getElementById('site-domain').value.trim();
  const { html: protectedHtml } = protectTemplateSyntax(html);
  const container = document.createElement('div');
  container.innerHTML = protectedHtml;

  const allAnchors = container.querySelectorAll('a[href]');
  const links = [];
  const groups = {};
  const warnings = [];

  allAnchors.forEach((a, rawIndex) => {
    const href = a.getAttribute('href');
    const normalized = normalizeUrl(href);

    if (!normalized) {
      if (href && href !== '#') {
        warnings.push({ type: 'broken', message: `Broken/invalid link: href="${href}" — "${(a.textContent||'').trim().slice(0,40)}"` });
      }
      return;
    }

    const img = isImageLink(a);
    const cta = !img && isCtaLink(a);
    const heading = isInHeading(a);
    const external = isExternalLink(href, domain);
    const parentTag = getParentTag(a);
    const context = getContext(a);
    const anchorText = img ? '[image]' : ((a.textContent || '').trim() || '[empty]');

    const link = {
      id: links.length,
      rawIndex,
      href,
      normalizedHref: normalized,
      anchorText,
      isImageLink: img,
      isCtaLink: cta,
      isInHeading: heading,
      isExternal: external,
      parentTag,
      context,
      keep: true,
      rel: a.getAttribute('rel') || ''
    };

    links.push(link);

    if (!groups[normalized]) {
      groups[normalized] = {
        normalizedHref: normalized,
        originalHref: href,
        links: [],
        imageCount: 0,
        textCount: 0,
        ctaCount: 0,
        inHeadingCount: 0
      };
    }
    const g = groups[normalized];
    g.links.push(link);
    if (img) g.imageCount++;
    else if (cta) g.ctaCount++;
    else g.textCount++;
    if (heading) g.inHeadingCount++;
  });

  // Edge case warnings
  for (const [url, group] of Object.entries(groups)) {
    if (group.textCount === 0 && group.ctaCount === 0 && group.imageCount > 0) {
      warnings.push({ type: 'image-only', message: `"${url}" only appears as image links (${group.imageCount}). Consider adding a text link for SEO.` });
    }
    if (group.inHeadingCount > 0) {
      warnings.push({ type: 'heading', message: `"${url}" has ${group.inHeadingCount} link(s) inside heading tags — consider removing.` });
    }
  }

  // Paragraph density
  container.querySelectorAll('p').forEach(p => {
    const count = p.querySelectorAll('a[href]').length;
    if (count >= 5) {
      warnings.push({ type: 'density', message: `High link density (${count} links) in paragraph: "${(p.textContent||'').slice(0,60).trim()}..."` });
    }
  });

  const totalLinks = links.length;
  const uniqueUrls = Object.keys(groups).length;
  const imageLinks = links.filter(l => l.isImageLink).length;
  const ctaLinks = links.filter(l => l.isCtaLink).length;
  const textLinks = totalLinks - imageLinks - ctaLinks;
  const externalLinks = links.filter(l => l.isExternal).length;

  return {
    links, groups, warnings,
    stats: { totalLinks, uniqueUrls, imageLinks, ctaLinks, textLinks, externalLinks }
  };
}

// ===== Auto-Strip Logic =====
function hasDifferentAnchors(textLinks) {
  if (textLinks.length < 2) return false;
  const normalized = textLinks.map(l => l.anchorText.toLowerCase().trim());
  return new Set(normalized).size > 1;
}

function applyAutoStrip() {
  for (const group of Object.values(state.groups)) {
    const textLinks = group.links.filter(l => !l.isImageLink && !l.isCtaLink);

    if (textLinks.length === 2 && hasDifferentAnchors(textLinks)) {
      // 2 text occurrences with different anchor text: keep both, let user decide
      group.links.forEach(l => l.keep = true);
    } else {
      // Same anchor or 3+: keep first text link, strip rest
      let firstTextKept = false;
      for (const link of group.links) {
        if (link.isImageLink || link.isCtaLink) {
          link.keep = true;
          continue;
        }
        if (!firstTextKept) {
          link.keep = true;
          firstTextKept = true;
        } else {
          link.keep = false;
        }
      }
    }
  }
}

function applyKeepAll() {
  state.links.forEach(l => l.keep = true);
}

// ===== HTML Generation =====
function processContainer(html, callback) {
  const { html: protectedHtml, placeholders } = protectTemplateSyntax(html);
  const container = document.createElement('div');
  container.innerHTML = protectedHtml;
  const anchors = Array.from(container.querySelectorAll('a[href]'));
  let linkIdx = 0;

  anchors.forEach(a => {
    const href = a.getAttribute('href');
    const normalized = normalizeUrl(href);
    if (!normalized) return;
    if (linkIdx < state.links.length) {
      callback(a, state.links[linkIdx]);
      linkIdx++;
    }
  });

  return { container, placeholders };
}

function generateCleanHtml() {
  const { container, placeholders } = processContainer(state.originalHtml, (a, link) => {
    if (!link.keep) {
      a.setAttribute('data-srlc-remove', 'true');
    }
  });

  // Unwrap removed links
  container.querySelectorAll('[data-srlc-remove]').forEach(a => {
    const parent = a.parentNode;
    while (a.firstChild) parent.insertBefore(a.firstChild, a);
    parent.removeChild(a);
  });

  // Strip target="_self" from all links (it's always the browser default, never needed)
  let targetSelfCount = 0;
  container.querySelectorAll('a[target="_self"]').forEach(a => {
    a.removeAttribute('target');
    targetSelfCount++;
  });
  state.targetSelfCount = targetSelfCount;

  return restoreTemplateSyntax(container.innerHTML, placeholders);
}

function generateCleanHtmlFromPreview() {
  const frame = document.getElementById('preview-frame');

  if (!frame.contentDocument || !frame.contentDocument.body) {
    return generateCleanHtml();
  }

  const body = frame.contentDocument.body;
  const clone = body.cloneNode(true);

  // Remove hint div and scripts
  const hint = clone.querySelector('.srlc-hint');
  if (hint) hint.remove();
  clone.querySelectorAll('script').forEach(s => s.remove());

  // Process toggleable links (data-link-id)
  clone.querySelectorAll('a[data-link-id]').forEach(a => {
    const linkId = parseInt(a.getAttribute('data-link-id'));
    const link = state.links.find(l => l.id === linkId);

    if (link && !link.keep) {
      // Unwrap: replace <a> with its children
      const parent = a.parentNode;
      while (a.firstChild) parent.insertBefore(a.firstChild, a);
      parent.removeChild(a);
    } else {
      // Kept: restore original attributes
      const origStyle = a.getAttribute('data-orig-style');
      const origTitle = a.getAttribute('data-orig-title');
      if (origStyle) a.setAttribute('style', origStyle); else a.removeAttribute('style');
      if (origTitle) a.setAttribute('title', origTitle); else a.removeAttribute('title');
      a.removeAttribute('data-link-id');
      a.removeAttribute('data-orig-style');
      a.removeAttribute('data-orig-title');
      a.removeAttribute('contenteditable');
    }
  });

  // Process protected links (image/CTA)
  clone.querySelectorAll('a[data-srlc-protected]').forEach(a => {
    const origStyle = a.getAttribute('data-orig-style');
    const origTitle = a.getAttribute('data-orig-title');
    if (origStyle) a.setAttribute('style', origStyle); else a.removeAttribute('style');
    if (origTitle) a.setAttribute('title', origTitle); else a.removeAttribute('title');
    a.removeAttribute('data-srlc-protected');
    a.removeAttribute('data-orig-style');
    a.removeAttribute('data-orig-title');
    a.removeAttribute('contenteditable');
  });

  // Strip target="_self" from all links (it's always the browser default, never needed)
  let targetSelfCount = 0;
  clone.querySelectorAll('a[target="_self"]').forEach(a => {
    a.removeAttribute('target');
    targetSelfCount++;
  });
  state.targetSelfCount = targetSelfCount;

  // Restore template syntax placeholders that were kept safe in the preview
  return restoreTemplateSyntax(clone.innerHTML, state.placeholders);
}

function generatePreviewHtml() {
  const { container, placeholders } = processContainer(state.originalHtml, (a, link) => {
    const toggleable = !link.isImageLink && !link.isCtaLink;

    // Save original attributes before overwriting
    a.setAttribute('data-orig-style', a.getAttribute('style') || '');
    a.setAttribute('data-orig-title', a.getAttribute('title') || '');

    if (link.keep) {
      a.style.cssText = 'background:#bbf7d0;padding:1px 3px;border-radius:3px;outline:1px solid #86efac;'
        + (toggleable ? 'cursor:pointer;' : '');
      a.setAttribute('title', toggleable ? 'Click to remove this link' : 'Image/CTA link (always kept)');
    } else {
      a.style.cssText = 'background:#fecaca;padding:1px 3px;border-radius:3px;text-decoration:line-through;color:#991b1b;cursor:pointer;';
      a.setAttribute('title', 'Click to keep this link');
    }

    // Make links non-editable so clicks toggle instead of placing cursor
    a.setAttribute('contenteditable', 'false');

    if (toggleable) {
      a.setAttribute('data-link-id', link.id);
    } else {
      a.setAttribute('data-srlc-protected', '1');
    }
  });

  // Keep placeholders in preview — restoring {{...}} here would break iframe
  // parsing because quotes inside attributes get mangled by the HTML parser.
  // Placeholders are restored during clean HTML extraction instead.
  state.placeholders = placeholders;
  const bodyHtml = container.innerHTML;
  return `<!DOCTYPE html><html><head><style>
    body{font-family:-apple-system,system-ui,sans-serif;padding:24px;line-height:1.7;font-size:14px;color:#333;max-width:800px;}
    body:focus{outline:none;}
    img{max-width:100%;height:auto;}
    table{border-collapse:collapse;width:100%;margin:1em 0;}
    td,th{border:1px solid #ddd;padding:8px;text-align:left;}
    a[data-link-id]:hover{opacity:0.7;transition:opacity 0.1s;}
    .srlc-hint{background:#f0f1f5;padding:6px 12px;border-radius:6px;font-size:11px;color:#6c7281;margin-bottom:16px;line-height:1.4;}
    .srlc-hint strong{color:#4f46e5;}
  </style></head><body contenteditable="true">
  <div class="srlc-hint" contenteditable="false">Click <strong style="background:#bbf7d0;padding:1px 4px;border-radius:3px;">green</strong> or <strong style="background:#fecaca;padding:1px 4px;border-radius:3px;text-decoration:line-through;color:#991b1b;">red</strong> links to toggle. Text around links is editable.</div>
  ${bodyHtml}
  <script>
    document.addEventListener('click', function(e) {
      var link = e.target.closest('a[data-link-id]');
      if (link) {
        e.preventDefault();
        e.stopPropagation();
        parent.postMessage({type:'srlc-toggle', id: parseInt(link.getAttribute('data-link-id'))}, '*');
      }
    });
    window.addEventListener('message', function(e) {
      if (!e.data) return;
      if (e.data.type === 'srlc-scroll') {
        window.scrollTo(0, e.data.scrollY);
      }
      if (e.data.type === 'srlc-update') {
        var link = document.querySelector('a[data-link-id="' + e.data.id + '"]');
        if (link) {
          if (e.data.keep) {
            link.style.cssText = 'background:#bbf7d0;padding:1px 3px;border-radius:3px;outline:1px solid #86efac;cursor:pointer;';
            link.setAttribute('title', 'Click to remove this link');
          } else {
            link.style.cssText = 'background:#fecaca;padding:1px 3px;border-radius:3px;text-decoration:line-through;color:#991b1b;cursor:pointer;';
            link.setAttribute('title', 'Click to keep this link');
          }
        }
      }
      if (e.data.type === 'srlc-update-all') {
        var updates = e.data.updates;
        for (var i = 0; i < updates.length; i++) {
          var u = updates[i];
          var link = document.querySelector('a[data-link-id="' + u.id + '"]');
          if (link) {
            if (u.keep) {
              link.style.cssText = 'background:#bbf7d0;padding:1px 3px;border-radius:3px;outline:1px solid #86efac;cursor:pointer;';
              link.setAttribute('title', 'Click to remove this link');
            } else {
              link.style.cssText = 'background:#fecaca;padding:1px 3px;border-radius:3px;text-decoration:line-through;color:#991b1b;cursor:pointer;';
              link.setAttribute('title', 'Click to keep this link');
            }
          }
        }
      }
    });
  <\/script>
  </body></html>`;
}

// ===== UI Rendering =====
function renderStats() {
  const bar = document.getElementById('stats-bar');
  const s = state.stats;
  const kept = state.links.filter(l => l.keep).length;
  const removed = state.links.filter(l => !l.keep).length;

  const parts = [
    `<div class="stat"><span class="stat-label">Total:</span> <span class="stat-value">${s.totalLinks}</span></div>`,
    `<div class="stat-dot"></div>`,
    `<div class="stat"><span class="stat-label">Unique URLs:</span> <span class="stat-value">${s.uniqueUrls}</span></div>`,
    `<div class="stat-dot"></div>`,
    `<div class="stat"><span class="stat-label">Text:</span> <span class="stat-value">${s.textLinks}</span></div>`,
    `<div class="stat-dot"></div>`,
    `<div class="stat"><span class="stat-label">Image:</span> <span class="stat-value">${s.imageLinks}</span></div>`,
  ];
  if (s.ctaLinks) {
    parts.push(`<div class="stat-dot"></div>`);
    parts.push(`<div class="stat"><span class="stat-label">CTA:</span> <span class="stat-value">${s.ctaLinks}</span></div>`);
  }
  if (s.externalLinks) {
    parts.push(`<div class="stat-dot"></div>`);
    parts.push(`<div class="stat"><span class="stat-label">External:</span> <span class="stat-value">${s.externalLinks}</span></div>`);
  }
  parts.push(`<div class="stat" style="margin-left:auto"><span style="color:#059669;font-weight:700">${kept} keeping</span></div>`);
  parts.push(`<div class="stat-dot"></div>`);
  parts.push(`<div class="stat"><span style="color:#dc2626;font-weight:700">${removed} removing</span></div>`);

  bar.innerHTML = parts.join('');
  bar.classList.add('visible');
}

function renderWarnings() {
  const el = document.getElementById('warnings');
  if (!state.warnings.length) { el.classList.remove('visible'); return; }
  const icons = { broken: '\u26A0', 'image-only': '\uD83D\uDDBC', heading: '\u24D8', density: '\u25CF' };
  el.innerHTML = state.warnings.map(w =>
    `<div class="warning">${icons[w.type]||'\u26A0'} ${escapeHtml(w.message)}</div>`
  ).join('');
  el.classList.add('visible');
}

function renderPreview() {
  const frame = document.getElementById('preview-frame');
  state.previewReady = false;
  frame.srcdoc = generatePreviewHtml();
  frame.addEventListener('load', function onLoad() {
    frame.removeEventListener('load', onLoad);
    state.previewReady = true;
  });
}

function renderCleanOutput() {
  if (state.previewReady) {
    document.getElementById('clean-output').value = generateCleanHtmlFromPreview();
  } else {
    document.getElementById('clean-output').value = generateCleanHtml();
  }
}

function renderChanges() {
  const el = document.getElementById('changes-content');
  const removed = state.links.filter(l => !l.keep);
  const totalChanges = removed.length + state.targetSelfCount;

  // Update tab badge
  const badge = document.getElementById('changes-badge');
  if (totalChanges > 0) {
    badge.textContent = totalChanges;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  if (totalChanges === 0) {
    el.innerHTML = '<div class="no-changes">No changes — all links are being kept.</div>';
    return;
  }

  let html = `<div class="changes-summary">
    <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 5h6"/></svg>
    ${totalChanges} change${totalChanges !== 1 ? 's' : ''}: ${removed.length} link${removed.length !== 1 ? 's' : ''} unwrapped${state.targetSelfCount > 0 ? `, ${state.targetSelfCount} target="_self" removed` : ''}
  </div>`;

  // target="_self" removals section
  if (state.targetSelfCount > 0) {
    html += `<div class="changes-section">
      <div class="changes-url-header">
        target="_self" cleanup
        <span class="changes-url-count">${state.targetSelfCount} stripped</span>
      </div>
      <div class="change-item change-item-attr">
        <code>target="_self"</code> removed from ${state.targetSelfCount} internal link${state.targetSelfCount !== 1 ? 's' : ''} (it's the browser default)
      </div>
    </div>`;
  }

  // Group link removals by URL
  if (removed.length > 0) {
    const byUrl = {};
    removed.forEach(l => {
      if (!byUrl[l.normalizedHref]) byUrl[l.normalizedHref] = [];
      byUrl[l.normalizedHref].push(l);
    });

    for (const [url, links] of Object.entries(byUrl)) {
      html += `<div class="changes-section">
        <div class="changes-url-header">
          ${escapeHtml(url)}
          <span class="changes-url-count">${links.length} removal${links.length>1?'s':''}</span>
        </div>`;
      links.forEach(l => {
        html += `<div class="change-item">
          <code>&lt;a href="..."&gt;</code> ${escapeHtml(l.anchorText)} <code>&lt;/a&gt;</code> &rarr; <strong>${escapeHtml(l.anchorText)}</strong>
          <div class="change-context">${escapeHtml(l.context)}</div>
        </div>`;
      });
      html += `</div>`;
    }
  }

  el.innerHTML = html;
}

// ===== UI Update Functions =====
function updateUI() {
  renderStats();
  renderPreview();
  renderCleanOutput();
  renderChanges();
}

function sendBulkUpdateToPreview() {
  const frame = document.getElementById('preview-frame');
  if (!frame.contentWindow) return;
  const updates = state.links
    .filter(l => !l.isImageLink && !l.isCtaLink)
    .map(l => ({ id: l.id, keep: l.keep }));
  frame.contentWindow.postMessage({ type: 'srlc-update-all', updates }, '*');
}

function updateUIPreservingPreview() {
  sendBulkUpdateToPreview();
  renderStats();
  renderCleanOutput();
  renderChanges();
}

// ===== Input Section Collapse =====
function collapseInput() {
  const body = document.getElementById('input-body');
  const bar = document.getElementById('input-collapse-bar');
  const summary = document.getElementById('input-collapse-summary');

  const charCount = state.originalHtml.length;
  const linkCount = state.stats.totalLinks;
  summary.textContent = `${charCount.toLocaleString()} chars, ${linkCount} links found`;

  body.classList.add('collapsed');
  bar.classList.remove('hidden');
}

function toggleInputSection() {
  const body = document.getElementById('input-body');
  const bar = document.getElementById('input-collapse-bar');
  const toggle = bar.querySelector('.input-collapse-toggle');

  if (body.classList.contains('collapsed')) {
    body.classList.remove('collapsed');
    toggle.textContent = 'Hide';
  } else {
    body.classList.add('collapsed');
    toggle.textContent = 'Show';
  }
}

// ===== Event Handlers =====
function handleAnalyze() {
  const html = document.getElementById('html-input').value.trim();
  if (!html) { showToast('Paste some HTML first'); return; }

  state.originalHtml = html;
  state.targetSelfCount = 0;
  state.previewReady = false;
  const result = analyzeHtml(html);
  state.links = result.links;
  state.groups = result.groups;
  state.warnings = result.warnings;
  state.stats = result.stats;

  applyAutoStrip();

  const removed = state.links.filter(l => !l.keep).length;

  // Check if article is already clean (no redundant links to strip)
  if (removed === 0) {
    renderWarnings();
    updateUI();
    document.getElementById('main-content').classList.add('visible');
    collapseInput();
    showCleanArticleBanner();
    showToast('\u2705 Article is clean — no redundant links!');
    return;
  }

  renderWarnings();
  updateUI();
  document.getElementById('main-content').classList.add('visible');
  collapseInput();
  hideCleanArticleBanner();

  showToast(`${state.stats.totalLinks} links, ${state.stats.uniqueUrls} unique URLs — ${removed} marked for removal`);
}

function showCleanArticleBanner() {
  let banner = document.getElementById('clean-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'clean-banner';
    const statsBar = document.getElementById('stats-bar');
    statsBar.parentNode.insertBefore(banner, statsBar.nextSibling);
  }
  banner.className = 'clean-banner visible';
  banner.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg> This article is clean — no redundant links found!';
}

function hideCleanArticleBanner() {
  const banner = document.getElementById('clean-banner');
  if (banner) banner.classList.remove('visible');
}

function handleAutoStrip() {
  applyAutoStrip();
  if (state.previewReady) {
    updateUIPreservingPreview();
  } else {
    updateUI();
  }
  showToast('Auto-strip applied');
}

function handleKeepAll() {
  applyKeepAll();
  if (state.previewReady) {
    updateUIPreservingPreview();
  } else {
    updateUI();
  }
  showToast('All links set to keep');
}

function handleNextArticle(e) {
  if (e) e.stopPropagation();
  state = { originalHtml: '', links: [], groups: {}, warnings: [], stats: {}, targetSelfCount: 0, previewReady: false };

  document.getElementById('html-input').value = '';
  document.getElementById('stats-bar').classList.remove('visible');
  document.getElementById('warnings').classList.remove('visible');
  document.getElementById('main-content').classList.remove('visible');
  document.getElementById('changes-badge').classList.add('hidden');
  hideCleanArticleBanner();

  document.getElementById('input-body').classList.remove('collapsed');
  document.getElementById('input-collapse-bar').classList.add('hidden');

  const textarea = document.getElementById('html-input');
  textarea.focus();

  showToast('Ready for next article');
}

function handleReset() {
  state = { originalHtml: '', links: [], groups: {}, warnings: [], stats: {}, targetSelfCount: 0, previewReady: false };
  document.getElementById('html-input').value = '';
  document.getElementById('stats-bar').classList.remove('visible');
  document.getElementById('warnings').classList.remove('visible');
  document.getElementById('main-content').classList.remove('visible');
  hideCleanArticleBanner();

  document.getElementById('input-body').classList.remove('collapsed');
  document.getElementById('input-collapse-bar').classList.add('hidden');

  document.getElementById('changes-badge').classList.add('hidden');
}

function handleCopy(e) {
  renderCleanOutput(); // Refresh to capture any text edits from preview
  const text = document.getElementById('clean-output').value;
  if (!text) { showToast('Nothing to copy'); return; }

  const btn = (e && e.currentTarget) || document.getElementById('copy-btn');
  const origInner = btn.innerHTML;

  const onCopied = () => {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.innerHTML = origInner; btn.classList.remove('copied'); }, 1500);
  };

  navigator.clipboard.writeText(text).then(onCopied, () => {
    document.getElementById('clean-output').select();
    document.execCommand('copy');
    onCopied();
  });
}

function handleDownload() {
  renderCleanOutput(); // Refresh to capture any text edits from preview
  const blob = new Blob([document.getElementById('clean-output').value], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cleaned-article.html';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Downloaded!');
}

function toggleLink(id) {
  const link = state.links.find(l => l.id === id);
  if (!link || link.isImageLink || link.isCtaLink) return;
  link.keep = !link.keep;

  // In-place update in iframe (preserves text edits)
  const frame = document.getElementById('preview-frame');
  if (frame.contentWindow) {
    frame.contentWindow.postMessage({ type: 'srlc-update', id, keep: link.keep }, '*');
  }

  // Update everything except preview
  renderStats();
  renderCleanOutput();
  renderChanges();
}

function switchTab(name) {
  document.querySelectorAll('#output-panel .tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('#output-panel .tab-content').forEach(tc =>
    tc.classList.toggle('active', tc.id === name + '-tab'));
  // Refresh clean output when switching to it (captures text edits)
  if (name === 'clean') renderCleanOutput();
}

// ===== Preview click-to-toggle =====
window.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'srlc-toggle') {
    toggleLink(e.data.id);
  }
});

// Keyboard shortcut
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    handleAnalyze();
  }
});
