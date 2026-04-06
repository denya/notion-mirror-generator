import { promptText } from './prompt-helpers'
import { validDomainName } from './validators'

export interface SiteConfig {
  domainName: string
  mainPageId: string
  siteName: string
  siteDescription: string
  siteImage: string
}

export async function getSiteConfigFromUser(domain: string): Promise<SiteConfig> {
  const siteConfig = { domainName: domain } as SiteConfig

  do {
    siteConfig.domainName = await promptText({
      key: 'domainName',
      message: 'Please confirm the domain name:',
      defaultValue: siteConfig.domainName,
    })

    if (!validDomainName(siteConfig.domainName)) {
      console.error('Invalid domain name:', siteConfig.domainName)
    }
  } while (!validDomainName(siteConfig.domainName))

  console.log(
    '\n🏷️  Metadata details.' +
      '\nYou can skip those fields now (press Enter) and fill them later via the config file.\n',
  )

  siteConfig.mainPageId = await promptText({
    key: 'mainPageId',
    message: 'ID of your Notion Page:',
  })
  siteConfig.siteName = await promptText({
    key: 'siteName',
    message: 'Your site name:',
  })
  siteConfig.siteDescription = await promptText({
    key: 'siteDescription',
    message: 'Your site description:',
  })
  siteConfig.siteImage = await promptText({
    key: 'siteImage',
    message: 'Link preview image URL:',
  })

  return siteConfig
}
