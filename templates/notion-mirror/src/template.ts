import type { PageData } from './notion-client'
import { getPageTitle, getPageIcon, getPageCover } from './notion-client'
import { renderBlocks } from './renderer'
import { escapeHtml, escapeAttr } from './rich-text'
import type { SiteConfig } from './config'
import { toProxiedAssetUrl, toSocialImageUrl } from './asset-url'
import { canonicalPagePath } from './page-path'

export interface Breadcrumb {
  label: string
  href: string | null
}

export function renderGoogleTagScript(googleTagId?: string): string {
  if (!googleTagId) {
    return ''
  }

  const googleTagIdJs = googleTagId.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

  return `  <!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(googleTagId)}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());

    gtag('config', '${googleTagIdJs}');
  </script>`
}

export function renderPage(pageData: PageData, config: SiteConfig, breadcrumbs?: Breadcrumb[]): string {
  const title = getPageTitle(pageData.page)
  const icon = getPageIcon(pageData.page)
  const cover = getPageCover(pageData.page)
  const bodyHtml = renderBlocks(pageData.blocks as any, config.domain, config.notionWorkspaceSlug, 0, new Map(), pageData.page.id)
  const canonicalPath = canonicalPagePath(pageData.page.id, title, config.rootPageId)
  const canonicalUrl = `https://${config.domain}${canonicalPath}`
  const pageDescription = extractPageDescription(pageData) || config.siteDescription
  const socialImage = cover || findFirstImage(pageData.blocks) || (icon?.startsWith('http') ? icon : null)
  const socialImageUrl = socialImage ? absoluteAssetUrl(config.domain, socialImage, true) : null

  const coverClass = config.hideMobileCoverImages ? 'page-cover page-cover-hide-mobile' : 'page-cover'
  const coverHtml = cover
    ? `<div class="${coverClass}"><img src="${escapeAttr(toProxiedAssetUrl(cover))}" alt=""></div>`
    : ''

  const iconHtml = icon
    ? icon.startsWith('http')
      ? `<span class="page-icon"><img src="${escapeAttr(toProxiedAssetUrl(icon))}" alt=""></span>`
      : `<span class="page-icon">${icon}</span>`
    : ''

  const fullTitle = icon && !icon.startsWith('http') ? `${icon} ${title}` : title
  const pageTitle = title === 'Untitled' ? config.siteName : `${title} | ${config.siteName}`
  const isRootPage = canonicalPath === '/'
  const headerHtml = renderHeader(config, breadcrumbs, isRootPage)
  const enhancements = getEnhancerScript(bodyHtml.includes('data-toc'))
  const logoUrl = config.logoUrl || ''
  const themeColor = config.themeColor || <%- jsString(brandThemeColor) %>
  const ogImageMeta = socialImageUrl
    ? `<meta property="og:image" content="${escapeAttr(socialImageUrl)}">
  <meta name="twitter:image" content="${escapeAttr(socialImageUrl)}">`
    : ''
  const twitterCard = socialImage ? 'summary_large_image' : 'summary'
  const faviconLinks = renderFaviconLinks(config.alwaysUseSiteLogoFavicon ? null : icon, logoUrl)
  const googleTagScript = renderGoogleTagScript(config.googleTagId)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeAttr(pageDescription)}">
  <meta name="theme-color" content="${escapeAttr(themeColor)}">
  <link rel="canonical" href="${escapeAttr(canonicalUrl)}">
  <meta property="og:site_name" content="${escapeAttr(config.siteName)}">
  <meta property="og:title" content="${escapeAttr(fullTitle)}">
  <meta property="og:description" content="${escapeAttr(pageDescription)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapeAttr(canonicalUrl)}">
  ${ogImageMeta}
  <meta name="twitter:card" content="${twitterCard}">
  <meta name="twitter:title" content="${escapeAttr(fullTitle)}">
  <meta name="twitter:description" content="${escapeAttr(pageDescription)}">
  ${faviconLinks}
  ${googleTagScript}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(config.googleFont)}:wght@400;500;700&display=swap" rel="stylesheet">
  <style>${getStyles(config.googleFont)}</style>
  <script>${getThemeInitScript()}</script>
</head>
<body data-page-state-key="${escapeAttr(canonicalPath)}">
  <a href="#main-content" class="skip-link">Skip to content</a>
  <div id="page-top" aria-hidden="true"></div>
  ${headerHtml}
  <div class="page">
    ${coverHtml}
    <main class="page-body" id="main-content">
      <header class="page-header">
        <div class="page-title-row">
          ${iconHtml}
          <h1 class="page-title">${escapeHtml(title)}</h1>
        </div>
      </header>
      <article class="page-content">
        ${bodyHtml}
      </article>
    </main>
    <footer class="page-footer" role="contentinfo">
      <p>&copy; ${new Date().getFullYear()} ${renderFooterLinks(config)}</p>
    </footer>
  </div>
  ${enhancements}
</body>
</html>`
}

function renderFaviconLinks(icon: string | null, fallbackLogoUrl: string): string {
  if (icon && /^https?:\/\//i.test(icon)) {
    const iconUrl = escapeAttr(toProxiedAssetUrl(icon))
    return `<link rel="icon" href="${iconUrl}">
  <link rel="apple-touch-icon" href="${iconUrl}">`
  }

  if (icon) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${escapeHtml(icon)}</text></svg>`
    const dataUrl = `data:image/svg+xml,${encodeURIComponent(svg)}`
    return `<link rel="icon" href="${dataUrl}">
  <link rel="apple-touch-icon" href="${dataUrl}">`
  }

  if (!fallbackLogoUrl) {
    return ''
  }

  const iconUrl = escapeAttr(toProxiedAssetUrl(fallbackLogoUrl))
  return `<link rel="icon" href="${iconUrl}">
  <link rel="apple-touch-icon" href="${iconUrl}">`
}

function getStyles(fontFamily: string): string {
  return `
    :root {
      --font-family: "${fontFamily}", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      --text-color: #171717;
      --text-secondary: #6a625c;
      --bg-color: #fffdfa;
      --bg-secondary: #fff8f3;
      --border-color: #f0e0d3;
      --accent-color: ${<%- jsString(brandThemeColor) %>};
      --accent-color-strong: #c14905;
      --accent-color-soft: #ffede0;
      --accent-color-pale: #fff4ea;
      --code-color: #c2410c;
      --link-color-internal: ${<%- jsString(brandThemeColor) %>};
      --link-color-internal-hover: #c14905;
      --link-color-external: #ed4f1a;
      --link-color-external-hover: #9f3518;
      --focus-ring: 0 0 0 2px var(--bg-color), 0 0 0 4px var(--accent-color);
      --selection-bg: #ffd8c1;
      --selection-fg: #000;
      --max-width: 900px;
      --page-padding: 96px;
      --line-height-body: 1.6;
      --line-height-heading: 1.14;
      --inline-gray-bg: #ebeced;
      --inline-gray-fg: #37352f;
      --inline-brown-bg: #e9e5e3;
      --inline-brown-fg: #64473a;
      --inline-orange-bg: #faebdd;
      --inline-orange-fg: #a85700;
      --inline-yellow-bg: #fbf3db;
      --inline-yellow-fg: #8f6400;
      --inline-green-bg: #ddedea;
      --inline-green-fg: #0f7b6c;
      --inline-blue-bg: #ddebf1;
      --inline-blue-fg: #0b6e99;
      --inline-purple-bg: #eae4f2;
      --inline-purple-fg: #6940a5;
      --inline-pink-bg: #f4dfeb;
      --inline-pink-fg: #ad1a72;
      --inline-red-bg: #fbe4e4;
      --inline-red-fg: #b42318;
    }
    [data-theme="dark"] {
        --text-color: #f7f3ef;
        --text-secondary: #c3b8af;
        --bg-color: #140f0c;
        --bg-secondary: #211813;
        --border-color: #3b2a1f;
        --accent-color: #ff8a38;
        --accent-color-strong: #ffb896;
        --accent-color-soft: #2a1b12;
        --accent-color-pale: #1b140f;
        --code-color: #ffb896;
        --link-color-internal: #ff8a38;
        --link-color-internal-hover: #ffd8c1;
        --link-color-external: #ffb896;
        --link-color-external-hover: #ffe0d1;
        --selection-bg: #7c2d12;
        --selection-fg: #fff;
        --inline-gray-bg: #30363d;
        --inline-gray-fg: #f2f4f8;
        --inline-brown-bg: #3a302a;
        --inline-brown-fg: #f1ddd2;
        --inline-orange-bg: #47301f;
        --inline-orange-fg: #ffd9b0;
        --inline-yellow-bg: #45381c;
        --inline-yellow-fg: #ffe8a3;
        --inline-green-bg: #17392d;
        --inline-green-fg: #bff3dd;
        --inline-blue-bg: #18394a;
        --inline-blue-fg: #d8effa;
        --inline-purple-bg: #322445;
        --inline-purple-fg: #eadbff;
        --inline-pink-bg: #45243b;
        --inline-pink-fg: #ffd8ee;
        --inline-red-bg: #482426;
        --inline-red-fg: #ffd8d6;
    }
    html {
      min-height: 100%;
      scroll-behavior: smooth;
      --anchor-offset: 48px;
      scroll-padding-top: calc(var(--anchor-offset) + 12px);
    }
    @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    ::selection { background: var(--selection-bg); color: var(--selection-fg); }
    :focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: 4px; }
    .skip-link {
      position: absolute;
      top: -100%;
      left: 16px;
      z-index: 200;
      padding: 8px 16px;
      background: var(--accent-color);
      color: #fff;
      border-radius: 0 0 6px 6px;
      font-size: 14px;
      font-weight: 500;
      text-decoration: none;
      transition: top 0.2s ease;
    }
    .skip-link:focus {
      top: 0;
      outline: none;
    }
    body {
      font-family: var(--font-family);
      color: var(--text-color);
      background: var(--bg-color);
      line-height: var(--line-height-body);
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
      min-height: 100vh;
      overflow-x: hidden;
      position: relative;
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background:
        radial-gradient(circle at top left, color-mix(in srgb, var(--accent-color) 14%, transparent) 0, transparent 36%),
        radial-gradient(circle at top right, color-mix(in srgb, var(--accent-color) 10%, transparent) 0, transparent 28%);
      z-index: -1;
    }
    .page {
      max-width: 100%;
      padding-bottom: max(28px, env(safe-area-inset-bottom));
    }
    .page-cover { width: 100%; height: 30vh; min-height: 200px; overflow: hidden; }
    .page-cover img { width: 100%; height: 100%; object-fit: cover; }
    .page-body { max-width: var(--max-width); margin: 0 auto; padding: 0 var(--page-padding); }
    @media (max-width: 768px) {
      .page-body { padding: 0 24px; }
      .page-cover-hide-mobile { display: none; }
    }
    .page-header { padding: 34px 0 12px; }
    .page-title-row {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      min-width: 0;
    }
    .page-icon {
      font-size: 54px;
      line-height: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
    }
    .page-icon img { width: 54px; height: 54px; border-radius: 12px; object-fit: cover; }
    .page-title {
      font-size: clamp(2.2rem, 4.4vw, 3.2rem);
      font-weight: 700;
      letter-spacing: -0.04em;
      line-height: 1.03;
      margin: 0;
      text-wrap: balance;
    }
    .page-content { padding-bottom: 60px; }
    .page-content > * + * { margin-top: 3px; }
    .page-content h1,
    .page-content h2,
    .page-content h3 { line-height: var(--line-height-heading); letter-spacing: -0.025em; }
    .page-content h1 { font-size: 1.8rem; margin-top: 28px; margin-bottom: 5px; }
    .page-content h2 {
      font-size: 1.28rem;
      margin-top: 22px;
      margin-bottom: 8px;
      padding: 5px 10px;
      border-radius: 10px;
      border: 1px solid color-mix(in srgb, var(--accent-color) 20%, var(--border-color));
      background: linear-gradient(135deg, var(--accent-color-pale), var(--accent-color-soft));
      color: var(--accent-color-strong);
    }
    [data-theme="dark"] .page-content h2 {
      border-color: color-mix(in srgb, var(--accent-color) 35%, var(--border-color));
      background: linear-gradient(135deg, color-mix(in srgb, var(--accent-color) 18%, transparent), color-mix(in srgb, #000 82%, var(--accent-color-soft)));
      color: var(--accent-color-strong);
    }
    .page-content h3 { font-size: 1.17rem; margin-top: 18px; margin-bottom: 3px; }
    .page-content p { margin: 1px 0; overflow-wrap: anywhere; }
    .page-content a {
      text-decoration: underline;
      text-decoration-thickness: 1.15px;
      text-decoration-color: color-mix(in srgb, currentColor 40%, transparent);
      text-underline-offset: 2.5px;
      transition: color 0.15s ease, text-decoration-color 0.15s ease;
    }
    .page-content a:hover { text-decoration-color: currentColor; }
    .page-content a.link-internal { color: var(--link-color-internal); }
    .page-content a.link-external { color: var(--link-color-external); }
    .page-content a.link-internal:hover { color: var(--link-color-internal-hover); }
    .page-content a.link-external:hover { color: var(--link-color-external-hover); }
    .page-content a.link-with-icon,
    .page-content .mention {
      display: inline-flex;
      align-items: baseline;
      gap: 0.35rem;
    }
    .page-content ul, .page-content ol { padding-left: 1.42em; margin: 2px 0; }
    .page-content li { margin: 1px 0; }
    .page-content li > ul, .page-content li > ol { margin: 0; }
    .page-content blockquote {
      border-left: 3px solid var(--text-color);
      padding: 4px 0 4px 16px;
      margin: 6px 0;
      overflow-wrap: anywhere;
    }
    .page-content hr {
      border: none;
      border-top: 1px solid var(--border-color);
      margin: 14px 0;
    }
    .page-content code {
      background: var(--bg-secondary);
      padding: 2px 5px;
      border-radius: 3px;
      font-size: 0.9em;
      font-family: "SFMono-Regular", Menlo, Consolas, monospace;
      color: var(--code-color);
    }
    .page-content pre {
      background: var(--bg-secondary);
      padding: 16px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 8px 0;
      border: 1px solid var(--border-color);
      font-size: 0.875em;
      line-height: 1.55;
    }
    .page-content pre code { background: none; padding: 0; color: inherit; font-size: inherit; }
    .callout {
      display: flex;
      gap: 12px;
      padding: 16px;
      border-radius: 14px;
      background: color-mix(in srgb, var(--bg-secondary) 84%, var(--accent-color-soft));
      margin: 10px 0 12px;
      border: 1px solid color-mix(in srgb, var(--accent-color) 14%, var(--border-color));
    }
    [data-theme="dark"] .callout {
      border-color: var(--border-color);
    }
    .callout-icon {
      font-size: 1.3em;
      flex-shrink: 0;
      margin-top: 2px;
      display: inline-flex;
      align-items: flex-start;
      justify-content: center;
      width: 1.4em;
    }
    .callout-icon .icon { width: 1.3em; height: 1.3em; }
    .callout-content {
      flex: 1;
      min-width: 0;
      display: grid;
      gap: 6px;
    }
    .callout-text,
    .callout-content p,
    .callout-content li { overflow-wrap: anywhere; }
    .callout-content a { overflow-wrap: anywhere; }
    .callout h1,
    .callout h2,
    .callout h3 {
      margin-top: 0;
      margin-bottom: 0;
      font-size: 1.15rem;
      line-height: 1.25;
      letter-spacing: -0.02em;
      overflow-wrap: anywhere;
    }
    .callout .toggle-heading summary {
      align-items: flex-start;
    }
    .callout .toggle-heading summary h1,
    .callout .toggle-heading summary h2,
    .callout .toggle-heading summary h3 {
      font-size: 1.15rem;
      line-height: 1.25;
    }
    .callout-gray_background { background: #f1f1ef; }
    .callout-blue_background { background: #d3e5ef; }
    .callout-yellow_background { background: #fbf3db; }
    .callout-green_background { background: #dbeddb; }
    .callout-pink_background { background: #f4dfeb; }
    .callout-purple_background { background: #e8deee; }
    .callout-red_background { background: #fbe4e4; }
    .callout-orange_background { background: #faebdd; }
    .callout-brown_background { background: #e9e5e3; }
    [data-theme="dark"] .callout-gray_background { background: #2f2f2f; }
    [data-theme="dark"] .callout-blue_background { background: #1a3044; }
    [data-theme="dark"] .callout-yellow_background { background: #3a2f1a; }
    [data-theme="dark"] .callout-green_background { background: #1a3a2a; }
    [data-theme="dark"] .callout-pink_background { background: #3a1a2f; }
    [data-theme="dark"] .callout-purple_background { background: #2a1a3a; }
    [data-theme="dark"] .callout-red_background { background: #3a1a1a; }
    [data-theme="dark"] .callout-orange_background { background: #3a2a1a; }
    [data-theme="dark"] .callout-brown_background { background: #2f2a27; }
    .callout .mention,
    .callout .child-page a,
    .callout .link-card,
    .callout .bookmark-card,
    .callout .bookmark {
      background: color-mix(in srgb, #ffffff 14%, transparent);
      border: 1px solid color-mix(in srgb, #ffffff 18%, transparent);
      box-shadow: none;
    }
    .callout .mention,
    .callout .child-page a {
      border-radius: 10px;
    }
    .callout .child-page a {
      margin: 0;
      padding: 6px 10px;
    }
    .callout .mention:hover,
    .callout .child-page a:hover,
    .callout .link-card:hover,
    .callout .bookmark-card:hover {
      background: color-mix(in srgb, #ffffff 20%, transparent);
      border-color: color-mix(in srgb, #ffffff 28%, transparent);
    }
    [data-theme="dark"] .callout .mention,
    [data-theme="dark"] .callout .child-page a,
    [data-theme="dark"] .callout .link-card,
    [data-theme="dark"] .callout .bookmark-card,
    [data-theme="dark"] .callout .bookmark {
      background: color-mix(in srgb, #ffffff 6%, transparent);
      border-color: color-mix(in srgb, #ffffff 12%, transparent);
    }
    [data-theme="dark"] .callout .mention:hover,
    [data-theme="dark"] .callout .child-page a:hover,
    [data-theme="dark"] .callout .link-card:hover,
    [data-theme="dark"] .callout .bookmark-card:hover {
      background: color-mix(in srgb, #ffffff 10%, transparent);
      border-color: color-mix(in srgb, #ffffff 18%, transparent);
    }
    .text-gray { color: #9b9a97; }
    .text-brown { color: #64473a; }
    .text-orange { color: #d9730d; }
    .text-yellow { color: #dfab01; }
    .text-green { color: #0f7b6c; }
    .text-blue { color: #0b6e99; }
    .text-purple { color: #6940a5; }
    .text-pink { color: #ad1a72; }
    .text-red { color: #e03e3e; }
    [data-theme="dark"] .text-gray { color: #979a9b; }
    [data-theme="dark"] .text-brown { color: #c4a388; }
    [data-theme="dark"] .text-orange { color: #faad5a; }
    [data-theme="dark"] .text-yellow { color: #f5d36e; }
    [data-theme="dark"] .text-green { color: #4dab9a; }
    [data-theme="dark"] .text-blue { color: #5ca7c4; }
    [data-theme="dark"] .text-purple { color: #a57fd6; }
    [data-theme="dark"] .text-pink { color: #d46fa7; }
    [data-theme="dark"] .text-red { color: #f08080; }
    .mention {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 1px 6px;
      border-radius: 6px;
      background: var(--bg-secondary);
      color: var(--link-color-internal);
      text-decoration: none !important;
      white-space: normal;
      transition: background-color 0.15s ease, color 0.15s ease;
    }
    .mention:hover {
      color: var(--link-color-internal-hover);
      background: color-mix(in srgb, var(--bg-secondary) 100%, var(--link-color-internal) 8%);
    }
    .mention-page::before { content: "@"; color: var(--text-secondary); }
    .mention-date::before { content: "🗓"; font-size: 0.85em; }
    .mention-user::before { content: "👤"; font-size: 0.85em; }
    .mention-page.mention-with-icon::before { content: ""; }
    .inline-page-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      width: 1.05rem;
      height: 1.05rem;
      line-height: 1;
    }
    .inline-page-icon-image {
      border-radius: 4px;
      object-fit: cover;
    }
    .bg-gray { background: var(--inline-gray-bg); color: var(--inline-gray-fg); padding: 2px 5px; border-radius: 3px; }
    .bg-brown { background: var(--inline-brown-bg); color: var(--inline-brown-fg); padding: 2px 5px; border-radius: 3px; }
    .bg-orange { background: var(--inline-orange-bg); color: var(--inline-orange-fg); padding: 2px 5px; border-radius: 3px; }
    .bg-yellow { background: var(--inline-yellow-bg); color: var(--inline-yellow-fg); padding: 2px 5px; border-radius: 3px; }
    .bg-green { background: var(--inline-green-bg); color: var(--inline-green-fg); padding: 2px 5px; border-radius: 3px; }
    .bg-blue { background: var(--inline-blue-bg); color: var(--inline-blue-fg); padding: 2px 5px; border-radius: 3px; }
    .bg-purple { background: var(--inline-purple-bg); color: var(--inline-purple-fg); padding: 2px 5px; border-radius: 3px; }
    .bg-pink { background: var(--inline-pink-bg); color: var(--inline-pink-fg); padding: 2px 5px; border-radius: 3px; }
    .bg-red { background: var(--inline-red-bg); color: var(--inline-red-fg); padding: 2px 5px; border-radius: 3px; }
    .to-do-block { margin: 2px 0; }
    .to-do {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin: 0;
    }
    .to-do input {
      margin-top: 5px;
      accent-color: var(--accent-color);
      width: 16px;
      height: 16px;
      cursor: pointer;
      flex-shrink: 0;
    }
    .to-do span { flex: 1; min-width: 0; }
    .to-do-children {
      padding-left: 32px;
      margin-top: 4px;
      display: grid;
      gap: 4px;
    }
    details { margin: 4px 0; }
    details summary { cursor: pointer; transition: background-color 0.12s ease; padding: 2px 4px; margin: -2px -4px; border-radius: 4px; overflow-wrap: anywhere; }
    details summary:hover { background: var(--bg-secondary); }
    .toggle-content { padding-left: 20px; margin-top: 2px; }
    .toggle summary,
    .toggle-heading summary {
      display: flex;
      align-items: baseline;
      gap: 7px;
      list-style: none;
    }
    .toggle summary::-webkit-details-marker,
    .toggle-heading summary::-webkit-details-marker { display: none; }
    .toggle summary::before,
    .toggle-heading summary::before {
      content: "▶";
      flex: 0 0 auto;
      font-size: 0.65em;
      line-height: 1.6;
      transition: transform 120ms ease;
      color: var(--text-secondary);
    }
    details[open] > summary::before { transform: rotate(90deg); }
    .toggle-summary,
    .toggle-heading-summary {
      display: block;
      min-width: 0;
      flex: 1 1 auto;
      overflow-wrap: anywhere;
    }
    .toggle-heading summary h1,
    .toggle-heading summary h2,
    .toggle-heading summary h3 {
      margin: 0;
    }
    .image-block { margin: 12px 0; }
    .image-block img { max-width: 100%; height: auto; border-radius: 4px; }
    .image-block figcaption, .code-block figcaption {
      text-align: center;
      color: var(--text-secondary);
      font-size: 0.875em;
      margin-top: 4px;
    }
    .video-block { margin: 10px 0; }
    .video-block iframe { width: 100%; aspect-ratio: 16/9; border: 0; border-radius: 8px; }
    .video-block video { max-width: 100%; border-radius: 4px; }
    .embed-block { margin: 10px 0; }
    .embed-block iframe { width: 100%; min-height: 380px; border: 1px solid var(--border-color); border-radius: 8px; }
    .bookmark,
    .link-card {
      margin: 6px 0;
      padding: 12px 14px;
      border: 1px solid var(--border-color);
      border-radius: 14px;
      background: color-mix(in srgb, var(--bg-secondary) 82%, transparent);
    }
    .link-card {
      display: flex;
      flex-direction: column;
      gap: 4px;
      color: inherit;
      text-decoration: none !important;
      transition: border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
    }
    .link-card:hover {
      border-color: color-mix(in srgb, var(--link-color-internal) 35%, var(--border-color));
      background: color-mix(in srgb, var(--bg-secondary) 92%, transparent);
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    }
    [data-theme="dark"] .link-card:hover {
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    }
    .bookmark a { display: block; word-break: break-all; }
    .link-card-kicker {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-secondary);
    }
    .link-card-title {
      color: var(--text-color);
      font-weight: 500;
      overflow-wrap: anywhere;
    }
    .link-card-url {
      font-size: 0.875rem;
      color: var(--link-color-internal);
      overflow-wrap: anywhere;
    }
    .bookmark-card {
      display: flex;
      margin: 6px 0;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      overflow: hidden;
      color: inherit;
      text-decoration: none !important;
      transition: border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
      background: color-mix(in srgb, var(--bg-secondary) 80%, transparent);
    }
    .bookmark-card:hover {
      border-color: color-mix(in srgb, var(--link-color-internal) 35%, var(--border-color));
      background: color-mix(in srgb, var(--bg-secondary) 92%, transparent);
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    }
    [data-theme="dark"] .bookmark-card:hover {
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    }
    .bookmark-card-info {
      flex: 1;
      min-width: 0;
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 4px;
    }
    .bookmark-card-title {
      font-weight: 500;
      font-size: 0.9rem;
      line-height: 1.4;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      color: var(--text-color);
    }
    .bookmark-card-description {
      font-size: 0.8rem;
      line-height: 1.45;
      color: var(--text-secondary);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .bookmark-card-url {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.8rem;
      color: var(--text-secondary);
      margin-top: 2px;
    }
    .bookmark-card-favicon {
      width: 16px;
      height: 16px;
      border-radius: 2px;
      flex-shrink: 0;
    }
    .bookmark-card-cover {
      flex: 0 0 33%;
      max-width: 260px;
      min-height: 100px;
    }
    .bookmark-card-cover img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .bookmark-caption {
      text-align: left;
      color: var(--text-secondary);
      font-size: 0.85rem;
      margin-top: 4px;
    }
    @media (max-width: 480px) {
      .bookmark-card { flex-direction: column-reverse; }
      .bookmark-card-cover { flex: none; max-width: none; max-height: 160px; overflow: hidden; }
    }
    .toc {
      margin: 4px 0;
      padding: 0;
    }
    .toc:empty { display: none; }
    .toc-title { display: none; }
    .toc-list {
      display: grid;
      gap: 0;
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .toc-link,
    .page-content .toc-link {
      display: block;
      color: var(--text-secondary);
      text-decoration: none;
      font-size: 14px;
      line-height: 1.5;
      padding: 1px 2px;
      transition: color 0.15s ease;
      overflow-wrap: anywhere;
    }
    .toc-link:hover,
    .page-content .toc-link:hover { color: var(--text-color); }
    .page-content .toc-depth-2 { padding-left: 24px; }
    .page-content .toc-depth-3 { padding-left: 48px; }
    @media (max-width: 768px) {
      .page-content .toc-depth-2 { padding-left: 16px; }
      .page-content .toc-depth-3 { padding-left: 32px; }
    }
    .columns { display: flex; gap: 32px; margin: 8px 0; align-items: flex-start; }
    .column { flex: 1; min-width: 0; }
    @media (max-width: 640px) { .columns { flex-direction: column; gap: 8px; } }
    .table-block {
      width: 100%;
      max-width: 100%;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      margin: 8px 0;
    }
    table {
      width: max-content;
      min-width: 100%;
      border-collapse: collapse;
      font-size: 0.9em;
    }
    th, td {
      border: 1px solid var(--border-color);
      padding: 8px 12px;
      text-align: left;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    th { background: var(--bg-secondary); font-weight: 600; }
    .child-page { margin: 0; }
    .child-page a {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      padding: 3px 6px;
      margin: 0 -6px;
      border-radius: 6px;
      text-decoration: none;
      line-height: 1.42;
      color: var(--link-color-internal);
      transition: background-color 0.12s ease, color 0.12s ease;
    }
    .child-page a:hover { background: var(--bg-secondary); }
    .child-page-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      font-size: 0.95em;
      line-height: 1.4;
    }
    .child-page-icon-image {
      width: 1.15rem;
      height: 1.15rem;
      border-radius: 4px;
      object-fit: cover;
    }
    .child-page-title { min-width: 0; }
    .child-database { padding: 4px 8px; color: var(--text-secondary); }
    .equation { font-family: "KaTeX_Math", serif; font-style: italic; margin: 8px 0; text-align: center; }
    .file-block, .audio-block, .pdf-block { margin: 8px 0; }
    .file-block a {
      color: var(--link-color-external);
      transition: color 0.15s ease;
    }
    .file-block a:hover { color: var(--link-color-external-hover); }
    .pdf-block iframe { width: 100%; min-height: 500px; border: 1px solid var(--border-color); }

    /* Heading anchor links */
    .heading-anchor {
      opacity: 0;
      text-decoration: none;
      font-size: 0.6em;
      margin-left: 8px;
      vertical-align: middle;
      transition: opacity 0.2s ease;
      cursor: pointer;
    }
    .page-content h1:hover .heading-anchor,
    .page-content h2:hover .heading-anchor,
    .page-content h3:hover .heading-anchor,
    .heading-anchor:focus-visible { opacity: 0.8; }
    .heading-anchor:hover { opacity: 1 !important; }
    #page-top,
    .page-content h1[id],
    .page-content h2[id],
    .page-content h3[id] {
      scroll-margin-top: calc(var(--anchor-offset) + 12px);
    }
    .page-footer {
      max-width: var(--max-width);
      margin: 0 auto;
      padding: 24px var(--page-padding) 40px;
      color: var(--text-secondary);
      font-size: 0.85em;
      border-top: 1px solid color-mix(in srgb, var(--accent-color) 18%, var(--border-color));
    }
    .page-footer .footer-link {
      color: var(--text-secondary);
      text-decoration: none;
      transition: color 0.15s ease;
    }
    .page-footer .footer-link:hover {
      color: var(--text-color);
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    @media (max-width: 768px) { .page-footer { padding: 24px 24px 40px; } }

    /* Header bar */
    .site-brand {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      flex: 0 0 auto;
      min-width: 0;
      text-decoration: none;
    }
    .site-brand-logo {
      width: 38px;
      height: 38px;
      border-radius: 10px;
      object-fit: cover;
      box-shadow: 0 10px 24px color-mix(in srgb, var(--accent-color) 22%, transparent);
      flex: 0 0 auto;
      border: 1px solid color-mix(in srgb, var(--accent-color) 16%, var(--border-color));
      background: #fff;
    }
    .site-brand-copy {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .site-header-label {
      font-size: 11px;
      line-height: 1.2;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--accent-color);
      font-weight: 700;
      white-space: nowrap;
    }
    .site-header-name {
      font-size: clamp(15px, 1.4vw, 17px);
      line-height: 1.12;
      font-weight: 700;
      color: var(--text-color);
      letter-spacing: -0.02em;
      white-space: nowrap;
    }
    .site-header {
      position: sticky;
      top: 0;
      z-index: 100;
      background: color-mix(in srgb, var(--bg-color) 92%, transparent);
      backdrop-filter: blur(12px) saturate(180%);
      -webkit-backdrop-filter: blur(12px) saturate(180%);
      border-bottom: 1px solid color-mix(in srgb, var(--accent-color) 12%, var(--border-color));
      transition: background-color 0.2s ease, border-color 0.2s ease;
    }
    .site-header-inner {
      max-width: 1100px;
      margin: 0 auto;
      min-height: 60px;
      display: flex;
      align-items: center;
      padding: 10px 24px;
      gap: 16px;
    }
    .site-header-main {
      display: flex;
      align-items: center;
      gap: 14px;
      min-width: 0;
      flex: 1 1 auto;
      overflow: hidden;
    }
    .site-header-trail {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      flex: 1 1 auto;
      flex-wrap: nowrap;
      overflow: hidden;
      white-space: nowrap;
    }
    .site-header-crumb {
      display: block;
      flex: 0 1 auto;
      color: color-mix(in srgb, var(--text-secondary) 86%, var(--accent-color));
      text-decoration: none;
      font-size: clamp(14px, 1.35vw, 18px);
      line-height: 1.25;
      font-weight: 500;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: color 0.15s ease;
    }
    .site-header-crumb:hover {
      color: var(--text-color);
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .site-header-current,
    .site-header-current:hover {
      flex: 1 1 auto;
      color: var(--text-color);
      font-weight: 700;
      text-decoration: none;
    }
    .site-header-sep {
      color: color-mix(in srgb, var(--text-secondary) 78%, var(--accent-color));
      font-size: 15px;
      line-height: 1;
      font-weight: 700;
      flex: 0 0 auto;
      user-select: none;
    }
    .theme-toggle {
      background: color-mix(in srgb, var(--accent-color-soft) 72%, transparent);
      border: 1px solid color-mix(in srgb, var(--accent-color) 16%, var(--border-color));
      border-radius: 12px;
      cursor: pointer;
      padding: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      flex-shrink: 0;
      color: var(--text-secondary);
      transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    }
    .theme-toggle:hover {
      background: color-mix(in srgb, var(--accent-color-soft) 100%, var(--bg-secondary));
      color: var(--accent-color);
    }
    .theme-toggle:focus-visible {
      box-shadow: var(--focus-ring);
    }
    .theme-toggle svg { width: 18px; height: 18px; }
    .theme-icon-sun, .theme-icon-moon { display: none; }
    :root .theme-icon-sun { display: block; }
    [data-theme="dark"] .theme-icon-sun { display: none; }
    [data-theme="dark"] .theme-icon-moon { display: block; }

    @media (max-width: 768px) {
      .site-header-inner { padding: 10px 16px; gap: 12px; align-items: center; }
      .site-brand-logo { width: 32px; height: 32px; border-radius: 9px; }
      .site-header-label { font-size: 10px; }
      .site-header-name { font-size: 14px; }
      .site-header-main { gap: 10px; }
      .site-header-trail { gap: 6px; padding-top: 1px; }
      .site-header-crumb { font-size: 15px; }
      .theme-toggle { width: 32px; height: 32px; }
    }
  `
}

function getEnhancerScript(hasToc: boolean): string {
  const tocScript = !hasToc ? '' : `
  // Build TOC
  const tocNodes = document.querySelectorAll('[data-toc]')
  if (tocNodes.length && headings.length) {
    tocNodes.forEach((tocNode) => {
      const list = document.createElement('ul')
      list.className = 'toc-list'
      headings.forEach((heading) => {
        const item = document.createElement('li')
        const link = document.createElement('a')
        const tagName = heading.tagName.toLowerCase()
        link.className = 'toc-link toc-depth-' + tagName.replace('h', '')
        link.href = '#' + heading.id
        link.textContent = heading.textContent?.replace(/\\s*🔗$/, '') || heading.id
        item.appendChild(link)
        list.appendChild(item)
      })
      tocNode.replaceChildren(list)
    })
  }`

  return `<script>
(() => {
  const pageStateKey = document.body?.dataset.pageStateKey || location.pathname
  const toggleStorageKey = (blockId) => 'nh:toggle:' + pageStateKey + ':' + blockId
  const checkboxStorageKey = (blockId) => 'nh:checkbox:' + pageStateKey + ':' + blockId
  const root = document.documentElement
  const anchorOffsetElements = Array.from(document.querySelectorAll('.site-header, .breadcrumbs'))
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')

  const syncAnchorOffset = () => {
    const stickyChromeHeight = anchorOffsetElements.reduce((total, element) => {
      if (!(element instanceof HTMLElement)) return total

      const position = window.getComputedStyle(element).position
      if (position !== 'sticky' && position !== 'fixed') return total

      return total + element.getBoundingClientRect().height
    }, 0)

    root.style.setProperty('--anchor-offset', Math.ceil(stickyChromeHeight || 48) + 'px')
  }

  const decodeHash = (hash) => {
    if (!hash || hash === '#') return ''

    const rawValue = hash.startsWith('#') ? hash.slice(1) : hash
    try {
      return decodeURIComponent(rawValue)
    } catch {
      return rawValue
    }
  }

  const openAncestorDetails = (element) => {
    let current = element.parentElement
    while (current) {
      if (current instanceof HTMLDetailsElement) current.open = true
      current = current.parentElement
    }
  }

  const scrollToHashTarget = (hash, behavior = reducedMotionQuery.matches ? 'auto' : 'smooth') => {
    const targetId = decodeHash(hash)
    if (!targetId) return false

    const target = document.getElementById(targetId)
    if (!target) return false

    openAncestorDetails(target)
    syncAnchorOffset()
    target.scrollIntoView({ block: 'start', behavior })
    return true
  }

  const scheduleHashScroll = (hash, behavior = 'auto') => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToHashTarget(hash, behavior)
      })
    })
  }

  syncAnchorOffset()

  if (typeof ResizeObserver !== 'undefined') {
    const resizeObserver = new ResizeObserver(() => {
      syncAnchorOffset()
    })
    anchorOffsetElements.forEach((element) => {
      if (element instanceof HTMLElement) resizeObserver.observe(element)
    })
  }

  window.addEventListener('resize', syncAnchorOffset)
  window.addEventListener('hashchange', () => {
    scheduleHashScroll(location.hash, 'auto')
  })
  window.addEventListener('load', () => {
    syncAnchorOffset()
    if (location.hash) scheduleHashScroll(location.hash, 'auto')
  })

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return

    const link = event.target.closest('a[href^="#"]')
    if (!(link instanceof HTMLAnchorElement)) return

    const href = link.getAttribute('href')
    if (!href || href === '#') return
    if (!scrollToHashTarget(href)) return

    event.preventDefault()
    if (location.hash === href) {
      history.replaceState(null, '', href)
    } else {
      history.pushState(null, '', href)
    }
  })

  document.querySelectorAll('details[data-block-id]').forEach((details) => {
    const blockId = details.getAttribute('data-block-id')
    if (!blockId) return

    const savedState = localStorage.getItem(toggleStorageKey(blockId))
    if (savedState === 'open') details.open = true
    if (savedState === 'closed') details.open = false

    details.addEventListener('toggle', () => {
      localStorage.setItem(toggleStorageKey(blockId), details.open ? 'open' : 'closed')
    })
  })

  document.querySelectorAll('input[type="checkbox"][data-block-id]').forEach((checkbox) => {
    const blockId = checkbox.getAttribute('data-block-id')
    if (!blockId) return

    const savedState = localStorage.getItem(checkboxStorageKey(blockId))
    if (savedState === 'checked') checkbox.checked = true
    if (savedState === 'unchecked') checkbox.checked = false

    checkbox.addEventListener('change', () => {
      localStorage.setItem(checkboxStorageKey(blockId), checkbox.checked ? 'checked' : 'unchecked')
    })
  })

  const headings = Array.from(
    document.querySelectorAll('.page-content h1[id], .page-content h2[id], .page-content h3[id]'),
  )

  // Add anchor links to headings
  headings.forEach((heading) => {
    const anchor = document.createElement('a')
    anchor.className = 'heading-anchor'
    anchor.href = '#' + heading.id
    anchor.textContent = '🔗'
    anchor.setAttribute('aria-label', 'Copy link to section')
    anchor.addEventListener('click', (e) => {
      e.preventDefault()
      const url = location.origin + location.pathname + '#' + heading.id
      navigator.clipboard.writeText(url).then(() => {
        anchor.textContent = '✓'
        setTimeout(() => { anchor.textContent = '🔗' }, 1500)
      })
    })
    heading.appendChild(anchor)
  })
  ${tocScript}
})()
</script>`
}

function extractPageDescription(pageData: PageData): string | null {
  const summaryText = collectBlockText(pageData.blocks).find((value) => value.length > 40) || collectBlockText(pageData.blocks)[0]
  return summaryText ? summaryText.slice(0, 220) : null
}

function collectBlockText(blocks: any[]): string[] {
  const values: string[] = []

  for (const block of blocks) {
    const payload = block[block.type]

    if (payload?.rich_text?.length) {
      const text = payload.rich_text.map((item: any) => item.plain_text || '').join(' ').replace(/\s+/g, ' ').trim()
      if (text) {
        values.push(text)
      }
    }

    if (block._children?.length) {
      values.push(...collectBlockText(block._children))
    }
  }

  return values
}

function findFirstImage(blocks: any[]): string | null {
  for (const block of blocks) {
    if (block.type === 'image') {
      const image = block.image
      if (image?.type === 'external') return image.external?.url || null
      if (image?.type === 'file') return image.file?.url || null
    }

    if (block._children?.length) {
      const childMatch = findFirstImage(block._children)
      if (childMatch) {
        return childMatch
      }
    }
  }

  return null
}

function absoluteAssetUrl(domain: string, url: string, social = false): string {
  if (!url) {
    return url
  }

  const proxied = social ? toSocialImageUrl(url) : toProxiedAssetUrl(url)
  if (proxied.startsWith('http')) {
    return proxied
  }

  return `https://${domain}${proxied}`
}

function renderHeader(config: SiteConfig, breadcrumbs: Breadcrumb[] | undefined, isRootPage: boolean): string {
  const logoUrl = escapeAttr(toProxiedAssetUrl(config.logoUrl))
  const trailItems = (isRootPage || !breadcrumbs?.length)
    ? []
    : breadcrumbs.map((crumb, index) => {
        const isLast = index === breadcrumbs.length - 1
        if (isLast) {
          return `<a href="#page-top" class="site-header-crumb site-header-current" aria-current="page">${escapeHtml(crumb.label)}</a>`
        }
        if (crumb.href) {
          return `<a href="${escapeAttr(crumb.href)}" class="site-header-crumb">${escapeHtml(crumb.label)}</a>`
        }
        return `<span class="site-header-crumb">${escapeHtml(crumb.label)}</span>`
      })
  const separator = '<span class="site-header-sep" aria-hidden="true">&gt;</span>'
  const trailHtml = trailItems.length
    ? `<nav class="site-header-trail" aria-label="Breadcrumb">${separator}${trailItems.join(separator)}</nav>`
    : ''
  return `<header class="site-header" role="banner">
  <div class="site-header-inner">
    <div class="site-header-main">
      <a href="/" class="site-brand" aria-label="${escapeAttr(config.brandName)} home">
        <img src="${logoUrl}" alt="${escapeAttr(config.brandName)} logo" class="site-brand-logo">
        <span class="site-brand-copy">
          <span class="site-header-label">${escapeHtml(config.siteName)}</span>
          <span class="site-header-name">${escapeHtml(config.brandName)}</span>
        </span>
      </a>
      ${trailHtml}
    </div>
    <button class="theme-toggle" id="theme-toggle" aria-label="Toggle theme">
      <svg class="theme-icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
      </svg>
      <svg class="theme-icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
      </svg>
    </button>
  </div>
</header>`
}

function renderFooterLinks(config: SiteConfig): string {
  const links: string[] = []

  if (config.footerOwnerName && config.footerOwnerUrl) {
    links.push(`<a href="${escapeAttr(config.footerOwnerUrl)}" class="footer-link">${escapeHtml(config.footerOwnerName)}</a>`)
  }

  if (config.footerSiteLabel && config.footerSiteUrl) {
    links.push(`<a href="${escapeAttr(config.footerSiteUrl)}" class="footer-link">${escapeHtml(config.footerSiteLabel)}</a>`)
  }

  return links.length ? links.join(' | ') : escapeHtml(config.brandName)
}

function getThemeInitScript(): string {
  return `(function(){var t=localStorage.getItem('nh-theme');if(!t)t=window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';document.documentElement.setAttribute('data-theme',t);document.addEventListener('DOMContentLoaded',function(){var b=document.getElementById('theme-toggle');if(b)b.addEventListener('click',function(){var c=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',c);localStorage.setItem('nh-theme',c)})})})();`
}
