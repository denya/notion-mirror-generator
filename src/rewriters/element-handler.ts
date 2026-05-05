/* eslint-disable class-methods-use-this */
import { MirrorSiteConfigFull } from '../types'

export interface HandleRule {
  attribute: string
  match: string
  action: {
    type: 'remove' | 'replace'
    value?: string
  }
}

export class ElementHandler {
  siteConfig: MirrorSiteConfigFull

  handleRules: HandleRule[]

  constructor(siteConfig: MirrorSiteConfigFull, handleRules: HandleRule[] = []) {
    this.siteConfig = siteConfig
    this.handleRules = handleRules
  }

  element(element: Element) {
    // console.log(`Incoming element: <${element.tagName}>${element.getAttribute('content')}</${element.tagName}>`)

    for (const rule of this.handleRules) {
      const attribute = element.getAttribute(rule.attribute) ?? ''

      if (attribute.match(rule.match)) {
        switch (rule.action.type) {
          case 'remove':
            element.remove()
            break
          case 'replace':
            element.setAttribute(rule.attribute, rule.action.value ?? '')
            break
          default:
            console.error(`Unknown action type in rule: ${JSON.stringify(rule, null, 2)}`)
            break
        }
      }
    }
  }
}
