export const BODY_JS_STRING = `
/* eslint-disable no-unused-vars */
/* eslint-disable prefer-rest-params */
/* eslint-disable no-lonely-if */
/* eslint-disable no-restricted-globals */
/* eslint-disable no-underscore-dangle */
/* eslint-disable no-undef */
localStorage.__console = true

const el = document.createElement('div')
let redirected = false

function getPage() {
  return location.pathname.slice(-32)
}

function getSlug() {
  return location.pathname.slice(1)
}

function updateSlug() {
  const slug = PAGE_TO_SLUG[getPage()]

  if (slug != null) {
    history.replaceState(history.state, '', ['/', slug].join(''))
  }
}

function enableConsoleEffectAndSetMode(mode) {
  if (__console && !__console.isEnabled) {
    __console.enable()
    window.location.reload()
  } else {
    __console?.environment?.ThemeStore?.setState({ mode })
    localStorage.setItem('newTheme', JSON.stringify({ mode }))
  }
}

// --- Theme Toggle ---
function getStoredTheme() {
  // Read our key first, fall back to Notion's own key
  var stored = localStorage.getItem('nh-theme')
  if (stored) return stored
  try {
    var notionTheme = JSON.parse(localStorage.getItem('newTheme'))
    if (notionTheme && notionTheme.mode) return notionTheme.mode
  } catch (e) { /* ignore */ }
  return 'light'
}

function applyThemeCSS(theme) {
  document.documentElement.setAttribute('data-theme', theme)
  localStorage.setItem('nh-theme', theme)
}

function applyThemeFull(theme) {
  applyThemeCSS(theme)
  enableConsoleEffectAndSetMode(theme)
}

function toggleTheme() {
  var current = document.documentElement.getAttribute('data-theme') || 'light'
  applyThemeFull(current === 'dark' ? 'light' : 'dark')
}

// Apply saved theme CSS immediately (Notion's ThemeStore not ready yet)
applyThemeCSS(getStoredTheme())

// --- Header Bar ---
function createHeader() {
  if (document.getElementById('mirror-header')) return

  var header = document.createElement('div')
  header.id = 'mirror-header'

  var inner = document.createElement('div')
  inner.className = 'nh-header-inner'

  var siteLink = document.createElement('a')
  siteLink.href = '/'
  siteLink.className = 'nh-site-name'
  siteLink.textContent = siteName

  var nav = document.createElement('nav')
  nav.className = 'nh-nav'

  var toggle = document.createElement('button')
  toggle.id = 'nh-theme-toggle'
  toggle.setAttribute('aria-label', 'Toggle theme')
  toggle.innerHTML = ''
    + '<svg class="nh-icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + '<circle cx="12" cy="12" r="5"/>'
    + '<line x1="12" y1="1" x2="12" y2="3"/>'
    + '<line x1="12" y1="21" x2="12" y2="23"/>'
    + '<line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>'
    + '<line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>'
    + '<line x1="1" y1="12" x2="3" y2="12"/>'
    + '<line x1="21" y1="12" x2="23" y2="12"/>'
    + '<line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>'
    + '<line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'
    + '</svg>'
    + '<svg class="nh-icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
    + '</svg>'
  toggle.addEventListener('click', toggleTheme)

  inner.appendChild(siteLink)
  inner.appendChild(nav)
  inner.appendChild(toggle)
  header.appendChild(inner)
  document.body.prepend(header)

  // Now that Notion app is loaded, sync the full theme (including ThemeStore)
  applyThemeFull(getStoredTheme())
}

// --- Breadcrumbs ---
function buildBreadcrumbs() {
  var existing = document.getElementById('mirror-breadcrumbs')
  if (existing) existing.remove()

  var currentSlug = getSlug()
  if (!currentSlug) return // no breadcrumbs on home page

  var parts = currentSlug.split('/')
  var crumbs = []

  // Home crumb
  crumbs.push({ label: siteName, href: '/' })

  // Build intermediate crumbs from slug segments
  var pathSoFar = ''
  for (var i = 0; i < parts.length; i++) {
    pathSoFar = pathSoFar ? pathSoFar + '/' + parts[i] : parts[i]

    // Check if this intermediate path is a known slug
    var isKnown = slugs.includes(pathSoFar)
    var isLast = i === parts.length - 1

    // Make the segment human-readable: replace hyphens with spaces, capitalize
    var label = parts[i]
      .replace(/-/g, ' ')
      .replace(/\b\w/g, function(c) { return c.toUpperCase() })

    crumbs.push({
      label: label,
      href: isLast ? null : (isKnown ? '/' + pathSoFar : null),
      isCurrent: isLast,
    })
  }

  // Only show breadcrumbs if there's more than just Home
  if (crumbs.length < 2) return

  var container = document.createElement('div')
  container.id = 'mirror-breadcrumbs'
  container.className = 'visible'

  var inner = document.createElement('div')
  inner.className = 'nh-breadcrumb-inner'

  crumbs.forEach(function(crumb, idx) {
    if (idx > 0) {
      var sep = document.createElement('span')
      sep.className = 'nh-breadcrumb-sep'
      sep.textContent = '/'
      inner.appendChild(sep)
    }

    if (crumb.isCurrent) {
      var span = document.createElement('span')
      span.className = 'nh-breadcrumb-current'
      span.textContent = crumb.label
      inner.appendChild(span)
    } else if (crumb.href) {
      var a = document.createElement('a')
      a.href = crumb.href
      a.textContent = crumb.label
      inner.appendChild(a)
    } else {
      var span2 = document.createElement('span')
      span2.textContent = crumb.label
      span2.style.color = 'var(--nh-text-secondary)'
      inner.appendChild(span2)
    }
  })

  container.appendChild(inner)

  // Insert after the header
  var headerEl = document.getElementById('mirror-header')
  if (headerEl && headerEl.nextSibling) {
    headerEl.parentNode.insertBefore(container, headerEl.nextSibling)
  } else {
    document.body.prepend(container)
  }
}

var observer = new MutationObserver(function() {
  if (redirected) return

  var nav = document.querySelector('.notion-topbar')
  var mobileNav = document.querySelector('.notion-topbar-mobile')

  if ((nav && nav.firstChild && nav.firstChild.firstChild) || (mobileNav && mobileNav.firstChild)) {
    updateSlug()
    redirected = true

    // Inject header and breadcrumbs once Notion app is ready
    createHeader()
    // Defer breadcrumbs so slug rewrite has taken effect
    setTimeout(buildBreadcrumbs, 0)

    var origOnPopState = window.onpopstate

    window.onpopstate = function () {
      if (slugs.includes(getSlug())) {
        var page = SLUG_TO_PAGE[getSlug()]

        if (page) {
          history.replaceState(history.state, 'bypass', ['/', page].join(''))
        }
      }

      if (origOnPopState) origOnPopState.apply(this, [].slice.call(arguments))
      updateSlug()
      buildBreadcrumbs()
    }
  }
})

var notionApp = document.querySelector('#notion-app') || document.body
observer.observe(notionApp, {
  childList: true,
  subtree: true,
})

var _replaceState = window.history.replaceState
var _back = window.history.back
var _forward = window.history.forward

window.history.back = function () {
  _back.apply(window.history, arguments)
}

window.history.forward = function () {
  _forward.apply(window.history, arguments)
}

window.history.replaceState = function () {
  if (arguments[1] === 'bypass') {
    return
  }

  var slug = getSlug()
  var isKnownSlug = slugs.includes(slug)

  if (arguments[2] === '/login') {
    var page = SLUG_TO_PAGE[slug]

    if (page) {
      arguments[2] = ['/', page].join('')
      _replaceState.apply(window.history, arguments)
      window.location.reload()

      return
    }
  } else {
    if (isKnownSlug && arguments[2] !== ['/', slug].join('')) {
      return
    }
  }

  _replaceState.apply(window.history, arguments)
}

var _pushState = window.history.pushState

window.history.pushState = function () {
  var dest = new URL(location.protocol + location.host + arguments[2])
  var id = dest.pathname.slice(-32)

  if (pages.includes(id)) {
    arguments[2] = ['/', PAGE_TO_SLUG[id]].join('')
  }

  var result = _pushState.apply(window.history, arguments)
  // Update breadcrumbs after navigation
  buildBreadcrumbs()
  return result
}

var _xhrOpen = window.XMLHttpRequest.prototype.open

window.XMLHttpRequest.prototype.open = function () {
  arguments[1] = arguments[1].replace(domain, notionDomain)

  if (arguments[1].indexOf('msgstore.' + notionDomain) > -1) {
    return
  }

  _xhrOpen.apply(this, [].slice.call(arguments))
}
`
