import { parseShortLinkRedirectStatus, parseShortLinks, type ShortLinkRedirectStatus } from './short-links'

export interface SiteConfig {
  rootPageId: string
  domain: string
  siteName: string
  brandName: string
  siteDescription: string
  cacheTtlSeconds: number
  notionWorkspaceSlug?: string
  slugToPage: Record<string, string>
  shortLinks: Record<string, string>
  shortLinkRedirectStatus: ShortLinkRedirectStatus
  googleFont: string
  googleTagId?: string
  googleAnalyticsConsentMode: boolean
  logoUrl: string
  themeColor: string
  footerOwnerName: string
  footerOwnerUrl: string
  footerSiteLabel: string
  footerSiteUrl: string
  enableToc: boolean
  hideMobileCoverImages: boolean
  alwaysUseSiteLogoFavicon: boolean
  legacyDomain?: string
}

export interface Env {
  NOTION_API_KEY: string
  PAGE_CACHE: KVNamespace
  IMAGE_STORE: R2Bucket
  ROOT_PAGE_ID: string
  SITE_DOMAIN: string
  LEGACY_SITE_DOMAIN?: string
  SITE_NAME: string
  SITE_DESCRIPTION: string
  CACHE_TTL_SECONDS: string
  NOTION_WORKSPACE_SLUG?: string
  GOOGLE_TAG_ID?: string
  GOOGLE_ANALYTICS_CONSENT_MODE?: string
  SHORT_LINKS_JSON?: string
  SHORT_LINK_REDIRECT_STATUS?: string
  ENABLE_TOC?: string
  HIDE_MOBILE_COVER_IMAGES?: string
  ALWAYS_USE_SITE_LOGO_FAVICON?: string
}

const BRAND_NAME = "startupvisa.barcelona"
// ?v=YYYYMMDD busts Cloudflare's edge fetch cache when the upstream PNG bytes change
// without renaming the file. Bump the value to force the worker to refetch from origin.
const BRAND_LOGO_URL = "https://startupvisa.barcelona/favicon.png?v=20260503"
const BRAND_THEME_COLOR = "#ea580c"
const FOOTER_OWNER_NAME = ""
const FOOTER_OWNER_URL = ""
const FOOTER_SITE_LABEL = "startupvisa.barcelona"
const FOOTER_SITE_URL = "https://spain.denyamsk.com"

export function getConfig(env: Env): SiteConfig {
  return {
    rootPageId: env.ROOT_PAGE_ID,
    domain: env.SITE_DOMAIN,
    siteName: env.SITE_NAME,
    brandName: BRAND_NAME,
    siteDescription: env.SITE_DESCRIPTION,
    cacheTtlSeconds: parseInt(env.CACHE_TTL_SECONDS, 10) || 86400,
    notionWorkspaceSlug: env.NOTION_WORKSPACE_SLUG,
    slugToPage: {
      '': env.ROOT_PAGE_ID,
    },
    shortLinks: parseShortLinks(env.SHORT_LINKS_JSON),
    shortLinkRedirectStatus: parseShortLinkRedirectStatus(env.SHORT_LINK_REDIRECT_STATUS),
    googleFont: 'Inter',
    googleTagId: env.GOOGLE_TAG_ID,
    googleAnalyticsConsentMode: env.GOOGLE_ANALYTICS_CONSENT_MODE === 'true',
    logoUrl: BRAND_LOGO_URL,
    themeColor: BRAND_THEME_COLOR,
    footerOwnerName: FOOTER_OWNER_NAME,
    footerOwnerUrl: FOOTER_OWNER_URL,
    footerSiteLabel: FOOTER_SITE_LABEL,
    footerSiteUrl: FOOTER_SITE_URL,
    enableToc: env.ENABLE_TOC === 'true',
    hideMobileCoverImages: env.HIDE_MOBILE_COVER_IMAGES === 'true',
    alwaysUseSiteLogoFavicon: env.ALWAYS_USE_SITE_LOGO_FAVICON === 'true',
    legacyDomain: env.LEGACY_SITE_DOMAIN,
  }
}
