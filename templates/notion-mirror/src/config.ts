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
  logoUrl: string
  themeColor: string
  footerOwnerName: string
  footerOwnerUrl: string
  footerSiteLabel: string
  footerSiteUrl: string
  hideMobileCoverImages: boolean
}

export interface Env {
  NOTION_API_KEY: string
  PAGE_CACHE: KVNamespace
  IMAGE_STORE: R2Bucket
  ROOT_PAGE_ID: string
  SITE_DOMAIN: string
  SITE_NAME: string
  SITE_DESCRIPTION: string
  CACHE_TTL_SECONDS: string
  NOTION_WORKSPACE_SLUG?: string
  GOOGLE_TAG_ID?: string
  SHORT_LINKS_JSON?: string
  SHORT_LINK_REDIRECT_STATUS?: string
  HIDE_MOBILE_COVER_IMAGES?: string
}

const BRAND_NAME = <%- jsString(brandName) %>
const BRAND_LOGO_URL = <%- jsString(brandLogoUrl) %>
const BRAND_THEME_COLOR = <%- jsString(brandThemeColor) %>
const FOOTER_OWNER_NAME = <%- jsString(footerOwnerName) %>
const FOOTER_OWNER_URL = <%- jsString(footerOwnerUrl) %>
const FOOTER_SITE_LABEL = <%- jsString(footerSiteLabel) %>
const FOOTER_SITE_URL = <%- jsString(footerSiteUrl) %>

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
    logoUrl: BRAND_LOGO_URL,
    themeColor: BRAND_THEME_COLOR,
    footerOwnerName: FOOTER_OWNER_NAME,
    footerOwnerUrl: FOOTER_OWNER_URL,
    footerSiteLabel: FOOTER_SITE_LABEL,
    footerSiteUrl: FOOTER_SITE_URL,
    hideMobileCoverImages: env.HIDE_MOBILE_COVER_IMAGES === 'true',
  }
}
