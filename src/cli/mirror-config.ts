import * as changeCase from 'change-case-all'
import { promptText } from './prompt-helpers'

export interface MirrorParserConfig {
  projectName: string
  packageJsonName: string
  domainName: string
  rootPageId: string
  siteName: string
  siteDescription: string
  notionWorkspaceSlug: string
  googleTagId: string
  shortLinks: Record<string, string>
  shortLinkRedirectStatus: string
  wranglerWorkerName: string
  r2BucketName: string
  brandName: string
  brandUrl: string
  brandHost: string
  brandLogoUrl: string
  brandThemeColor: string
  footerOwnerName: string
  footerOwnerUrl: string
  footerSiteLabel: string
  footerSiteUrl: string
}

export async function getMirrorParserConfig(projectName: string | undefined): Promise<MirrorParserConfig> {
  const normalizedProjectName = changeCase.kebabCase(projectName || 'notion-mirror')

  const packageJsonName = await promptText({
    key: 'packageJsonName',
    message: 'Local project/repo slug:',
    defaultValue: normalizedProjectName,
  })
  const domainName = await promptText({
    key: 'domainName',
    message: 'Public domain name:',
  })
  const rootPageId = await promptText({
    key: 'rootPageId',
    message: 'Root Notion page ID:',
  })
  const siteName = await promptText({
    key: 'siteName',
    message: 'Site name:',
    defaultValue: domainName,
  })
  const siteDescription = await promptText({
    key: 'siteDescription',
    message: 'Site description:',
  })
  const notionWorkspaceSlug = await promptText({
    key: 'notionWorkspaceSlug',
    message: 'Notion workspace slug (optional):',
  })
  const googleTagId = await promptText({
    key: 'googleTagId',
    message: 'Google Tag ID (optional):',
  })
  const shortLinkRedirectStatus = await promptText({
    key: 'shortLinkRedirectStatus',
    message: 'Short link redirect status:',
    defaultValue: '302',
  })
  const shortLinks = parseJsonRecord(
    await promptText({
      key: 'shortLinksJson',
      message: 'Short links JSON (optional):',
      defaultValue: '{}',
    }),
    'Short links JSON',
  )
  const brandName = await promptText({
    key: 'brandName',
    message: 'Brand label:',
    defaultValue: domainName,
  })
  const brandUrl = await promptText({
    key: 'brandUrl',
    message: 'Brand URL:',
    defaultValue: `https://${domainName}`,
  })
  const brandLogoUrl = await promptText({
    key: 'brandLogoUrl',
    message: 'Brand logo URL:',
    defaultValue: `${brandUrl.replace(/\/$/, '')}/favicon.png`,
  })
  const brandThemeColor = await promptText({
    key: 'brandThemeColor',
    message: 'Theme color:',
    defaultValue: '#ea580c',
  })
  const footerOwnerName = await promptText({
    key: 'footerOwnerName',
    message: 'Footer owner name:',
    defaultValue: '',
  })
  const footerOwnerUrl = await promptText({
    key: 'footerOwnerUrl',
    message: 'Footer owner URL:',
    defaultValue: '',
  })
  const footerSiteLabel = await promptText({
    key: 'footerSiteLabel',
    message: 'Footer site label:',
    defaultValue: brandName,
  })
  const footerSiteUrl = await promptText({
    key: 'footerSiteUrl',
    message: 'Footer site URL:',
    defaultValue: brandUrl,
  })

  return {
    projectName: packageJsonName,
    packageJsonName,
    domainName,
    rootPageId,
    siteName,
    siteDescription,
    notionWorkspaceSlug,
    googleTagId,
    shortLinks,
    shortLinkRedirectStatus,
    wranglerWorkerName: `${packageJsonName}-notion-proxy`,
    r2BucketName: `${packageJsonName}-notion-images`,
    brandName,
    brandUrl,
    brandHost: extractHost(brandUrl),
    brandLogoUrl,
    brandThemeColor,
    footerOwnerName,
    footerOwnerUrl,
    footerSiteLabel,
    footerSiteUrl,
  }
}

function parseJsonRecord(value: string, label: string): Record<string, string> {
  const trimmed = value.trim()
  if (!trimmed) {
    return {}
  }

  const parsed = JSON.parse(trimmed) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`)
  }

  return Object.fromEntries(
    Object.entries(parsed).map(([key, entryValue]) => [key, String(entryValue)]),
  )
}

function extractHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
  }
}
