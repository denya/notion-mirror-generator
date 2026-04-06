import { NoteHostSiteConfigFull } from '../types'

/* eslint-disable class-methods-use-this */
export class HeadRewriter {
  siteConfig: NoteHostSiteConfigFull

  constructor(siteConfig: NoteHostSiteConfigFull) {
    this.siteConfig = siteConfig
  }

  element(element: Element) {
    const { googleFont, customHeadJS, customHeadCSS } = this.siteConfig

    if (googleFont) {
      element.append(
        `<link href='https://fonts.googleapis.com/css?family=${googleFont.replace(
          ' ',
          '+',
        )}:Regular,Bold,Italic&display=swap' rel='stylesheet'>
          <style>* { font-family: "${googleFont}" !important; }</style>`,
        {
          html: true,
        },
      )
    }

    element.append(
      `<style>
        /* Hide Notion's default topbar */
        div.notion-topbar, div.notion-topbar-mobile { display: none !important; }

        /* Theme variables */
        :root {
          --nh-bg: #ffffff;
          --nh-text: #37352f;
          --nh-text-secondary: #6b6b6b;
          --nh-border: #e8e8e8;
          --nh-hover: #f0f0f0;
          --nh-breadcrumb-link: #37352f;
          --nh-breadcrumb-sep: #b0b0b0;
        }
        [data-theme="dark"] {
          --nh-bg: #191919;
          --nh-text: #e0e0e0;
          --nh-text-secondary: #9b9b9b;
          --nh-border: #333333;
          --nh-hover: #2a2a2a;
          --nh-breadcrumb-link: #c8c8c8;
          --nh-breadcrumb-sep: #555555;
        }

        /* Smooth theme transitions */
        #notehost-header,
        #notehost-breadcrumbs,
        #notehost-header * ,
        #notehost-breadcrumbs * {
          transition: background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease;
        }

        /* Header bar */
        #notehost-header {
          position: sticky;
          top: 0;
          z-index: 1000;
          height: 56px;
          background: var(--nh-bg);
          border-bottom: 1px solid var(--nh-border);
          font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        .nh-header-inner {
          max-width: 1100px;
          margin: 0 auto;
          height: 100%;
          display: flex;
          align-items: center;
          padding: 0 24px;
          gap: 16px;
        }
        .nh-site-name {
          font-size: 15px;
          font-weight: 600;
          color: var(--nh-text);
          text-decoration: none;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .nh-site-name:hover { opacity: 0.8; }
        .nh-nav {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-left: auto;
        }
        .nh-nav a {
          font-size: 14px;
          color: var(--nh-text-secondary);
          text-decoration: none;
          padding: 6px 12px;
          border-radius: 6px;
        }
        .nh-nav a:hover {
          color: var(--nh-text);
          background: var(--nh-hover);
        }

        /* Theme toggle button */
        #nh-theme-toggle {
          background: none;
          border: 1px solid var(--nh-border);
          border-radius: 8px;
          cursor: pointer;
          padding: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          flex-shrink: 0;
          color: var(--nh-text-secondary);
        }
        #nh-theme-toggle:hover {
          background: var(--nh-hover);
          color: var(--nh-text);
        }
        #nh-theme-toggle svg { width: 18px; height: 18px; }
        .nh-icon-sun, .nh-icon-moon { display: none; }
        :root .nh-icon-sun { display: block; }
        :root .nh-icon-moon { display: none; }
        [data-theme="dark"] .nh-icon-sun { display: none; }
        [data-theme="dark"] .nh-icon-moon { display: block; }

        /* Breadcrumbs */
        #notehost-breadcrumbs {
          max-width: 900px;
          margin: 0 auto;
          padding: 12px 16px 4px;
          font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          font-size: 14px;
          line-height: 1.4;
          display: none;
        }
        #notehost-breadcrumbs.visible { display: block; }
        .nh-breadcrumb-inner {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 4px;
        }
        .nh-breadcrumb-inner a {
          color: var(--nh-breadcrumb-link);
          text-decoration: none;
          opacity: 0.7;
        }
        .nh-breadcrumb-inner a:hover {
          opacity: 1;
          text-decoration: underline;
        }
        .nh-breadcrumb-sep {
          color: var(--nh-breadcrumb-sep);
          font-size: 12px;
          user-select: none;
        }
        .nh-breadcrumb-current {
          color: var(--nh-text);
          font-weight: 500;
        }

        /* Mobile adjustments */
        @media (max-width: 768px) {
          .nh-header-inner { padding: 0 16px; }
          .nh-site-name { font-size: 14px; }
          .nh-nav a { font-size: 13px; padding: 4px 8px; }
          #notehost-breadcrumbs { padding: 8px 16px 2px; font-size: 13px; }
        }
        @media (max-width: 480px) {
          .nh-nav { gap: 4px; }
          .nh-nav a { padding: 4px 6px; font-size: 12px; }
        }

        ${customHeadCSS ?? ''}
        </style>
        ${customHeadJS ?? ''}`,
      {
        html: true,
      },
    )
  }
}
