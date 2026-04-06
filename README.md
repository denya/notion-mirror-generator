# NoteHost

This repo now has two scaffold paths:

1. `notehost init <domain>` for the legacy lightweight worker starter.
2. `notehost init-mirror <project-name>` for the newer reusable Notion backup-plus-mirror stack with local JSON/static export, localhost preview, Cloudflare KV/R2 cache serving, and agent-friendly setup files.

## Recommended path

Build the CLI once:

```sh
npm run build
```

Generate a new reusable mirror repo. For multiple sites in one workspace, use a nested path such as `data/sites/my-notion-site`:

```sh
node dist/cli/index.js init-mirror data/sites/my-notion-site
```

The modern scaffold asks for the domain, Notion root page, workspace slug, branding, analytics, short links, and footer/brand links, then renders a standalone repo from `templates/notion-mirror/`.

## Skill-assisted setup

This repo now includes a Codex skill at `.codex/skills/setup-notion-mirror/SKILL.md`.

Invoke it from the repo root with:

```text
$setup-notion-mirror
```

Use the skill when you want Codex to drive the full setup flow instead of just generating files. The skill is intended to:

- collect missing project/domain/branding preferences
- explain how to get the Notion integration API key and root page ID
- explain the Cloudflare and Wrangler prerequisites
- scaffold the mirror repo from `templates/notion-mirror/`
- create a local backup/export under `data/sites/<site-key>/`
- launch the localhost copy of the rendered site
- prepare `.env` and `.dev.vars`
- review `wrangler.toml` and deploy settings
- deploy, warm caches, and verify the live result

## Manual setup checklist

### 1. Gather Notion inputs

Before scaffolding, collect:

1. `NOTION_API_KEY`
2. the public site domain
3. the root Notion page ID
4. the workspace slug if you want workspace-domain hints
5. brand/template preferences such as name, logo, theme color, footer links, analytics, and short links

How to get the Notion API key and page access:

1. In Notion, create an internal integration.
2. Give it read access to content.
3. Copy the secret and keep it as `NOTION_API_KEY`.
4. Open the root page you want to mirror and share it with that integration.
5. Copy the page ID from the URL.

### 2. Gather Cloudflare prerequisites

The generated mirror uses Cloudflare Workers, KV, R2, routes, and secrets.

Make sure:

1. the domain is managed by Cloudflare
2. the target hostname is proxied through Cloudflare
3. Wrangler auth works via `bunx wrangler login` or `CLOUDFLARE_API_TOKEN`
4. the auth can manage Workers, KV, R2, custom domains/routes, and secrets

### 3. Scaffold the backup/mirror repo

Build the CLI and generate the repo:

```sh
npm run build
node dist/cli/index.js init-mirror data/sites/my-notion-site
```

The scaffold prompts for:

- local project slug
- public domain
- root page ID
- site name and description
- workspace slug
- Google Tag ID
- short links and redirect status
- brand/footer links and theme color

### 4. Prepare the generated repo

Enter the generated repo and bootstrap local files:

```sh
cd my-notion-site
bun install
bun run setup
```

`bun run setup` creates `.env` and `.dev.vars`. If `NOTION_API_KEY` is already in your shell, it copies that value into both files automatically.

Review these generated values before deploying:

- worker name
- custom domain route
- root page ID
- KV namespace placeholder
- R2 bucket name
- brand/footer defaults

### 5. Create the local backup and localhost mirror

Before Cloudflare deploy, create the local copy:

```sh
bun run backup
```

For a broader local backup that includes private pages accessible to the integration, use:

```sh
bun run backup:workspace
```

This writes:

- JSON snapshots to `data/sites/<site-key>/backup/`
- static locally-served output to `data/sites/<site-key>/site/`

Launch it with:

```sh
bun run serve:local
```

### 6. Deploy with Wrangler

Run:

```sh
./deploy.sh
```

The deploy script:

- checks Wrangler auth
- creates the KV namespace if needed
- creates the R2 bucket if needed
- stores `NOTION_API_KEY` as a Cloudflare secret
- deploys the worker

### 7. Verify the mirror

After deploy, verify:

```sh
bun run warm:notion
```

Then check:

1. `https://<your-domain>/`
2. `https://<your-domain>/sitemap.xml`
3. one representative child page
4. any configured short links
5. `http://localhost:8788/`
6. `bun run logs` if something looks wrong

If you want Codex to help after scaffolding, the generated repo also includes repo-local skills:

- `.codex/skills/setup-notion-mirror/`
- `.codex/skills/site-warmup/`

Generated mirror repos include:

- `wrangler.toml` with project-specific Cloudflare bindings and vars
- `deploy.sh` to create KV/R2 resources and publish the worker
- `scripts/setup.ts` to create `.env` and `.dev.vars`
- `.codex/skills/setup-notion-mirror/` and `.codex/skills/site-warmup/` for Codex/Claude-driven setup
- cache warming scripts for cheap rerenders vs full Notion refreshes

## Legacy starter

The original NoteHost worker starter still exists below.

<br/>

## How to use the legacy starter:

### Setup your Cloudflare account

---

1. Add your domain to Cloudflare. Make sure that DNS doesn't have `A` records for your domain and no `CNAME` alias for `www`
2. Create a new worker on Cloudflare and give it a meaningful name, e.g. `yourdomain-com-notion-proxy`
3. Keep the default example worker code, we will overwrite it anyway during deploy (see below)

> [!TIP]
> A bit outdated but detailed description on how to add your domain to Cloudflare and create a worker is [here](https://stephenou.notion.site/stephenou/Fruition-Free-Open-Source-Toolkit-for-Building-Websites-with-Notion-771ef38657244c27b9389734a9cbff44).
>
> Search for "Step 1: Set up your Cloudflare account".
>
> If someone wishes to create an up-to-date tutorial for NoteHost, please submit a pull request 😉

<br/>

### Generate your NoteHost worker

---

Go into your working directory and run:

```sh
npx notehost init <domain>
```

Follow the prompts to confirm your domain name and enter the requested information. You can change these settings later via the configuration file.

NoteHost will create a directory with the name of your domain. In this directory you will see the following files:

```
.
├── build-page-script-js-string.sh    helper script, details below
├── package.json                      test & deploy your website, see realtime logs
├── tsconfig.json                     types config
├── wrangler.toml                     your Cloudflare worker config
└── src
    ├── _page-script-js-string.ts     generated by helper script
    ├── index.ts                      runs reverse proxy
    ├── page-script.js                your custom JS page script
    └── site-config.ts                your domain and website config
```

Go into this directory and run

```sh
npm install
```

<br/>

### Configure your domain

---

Make sure that wrangler is authenticated with your Cloudflare account

```sh
npx wrangler login
```

1. Edit `wrangler.toml` and make sure that the `name` field matches your worker name in Cloudflare
2. Edit `site-config.ts` and set all the necessary options: domain, metadata, slugs, subdomain redirects, etc. All settings should be self explanatory, I hope 😊

```ts filename="src/site-config.ts"
import { NoteHostSiteConfig, googleTag } from 'notehost'
import { PAGE_SCRIPT_JS_STRING } from './_page-script-js-string'

// Set this to your Google Tag ID from Google Analytics
const GOOGLE_TAG_ID = ''

export const SITE_CONFIG: NoteHostSiteConfig = {
  domain: 'yourdomain.com',

  // Metatags, optional
  // For main page link preview
  siteName: 'My Notion Website',
  siteDescription: 'Build your own website with Notion. This is a demo site.',
  siteImage: 'https://imagehosting.com/images/preview.jpg',

  // URL to custom favicon.ico
  siteIcon: 'https://imagehosting.com/images/favicon.ico',

  // Social media links, optional
  twitterHandle: '@mytwitter',

  // Additional safety: avoid serving extraneous Notion content from your website
  // Use the value from your Notion settings => Workspace => Settings => Domain
  notionDomain: 'mydomain',

  // Map slugs (short page names) to Notion page IDs
  // Empty slug is your main page
  slugToPage: {
    '': 'NOTION_PAGE_ID',
    about: 'NOTION_PAGE_ID',
    contact: 'NOTION_PAGE_ID',
    // Hint: you can use '/' in slug name to create subpages
    'about/people': 'NOTION_PAGE_ID',
  },

  // Rewrite meta tags for specific pages
  // Use the Notion page ID as the key
  pageMetadata: {
    'NOTION_PAGE_ID': {
      title: 'My Custom Page Title',
      description: 'My custom page description',
      image: 'https://imagehosting.com/images/page_preview.jpg',
      author: 'My Name',
    },
  },

  // Subdomain redirects are optional
  // But it is recommended to have one for www
  subDomains: {
    www: {
      redirect: 'https://yourdomain.com',
    },
  },

  // The 404 (not found) page is optional
  // If you don't have one, the default 404 page will be used
  fof: {
    page: 'NOTION_PAGE_ID',
    slug: '404', // default
  },

  // Google Font name, you can choose from https://fonts.google.com
  googleFont: 'Roboto',

  // Custom CSS/JS for head and body of a Notion page
  customHeadCSS: `
  .notion-topbar {
    background: lightblue
  }`,
  customHeadJS: googleTag(GOOGLE_TAG_ID),
  customBodyJS: PAGE_SCRIPT_JS_STRING,
}
```

<br/>

### Deploy your website

---

```sh
npm run deploy
```

🎉 Enjoy your Notion website on your own domain! 🎉

> [!IMPORTANT]
> You need to run deploy every time you update `page-script.js` or `site-config.ts`.

<br/>

### What is build-page-script-js-string.sh?

---

The file `src/page-script.js` contains an example of a page script that you can run on your Notion pages.
This example script removes tooltips from images and hides optional properties in database cards.

🔥 This script is run in the web browser! 🔥

You can use `document`, `window` and all the functionality of a web browser to control the contents and behavior of your Notion pages.
Also, because this is a JS file, you can edit it in your code editor with syntax highlighting and intellisense!

To incorporate this script into a Notion page, NoteHost must transform the file's contents into a string. Consequently, the `build-page-script-js-string.sh` script is executed whenever you run `npm run deploy`.

So just add your JS magic to `page-script.js`, run deploy and everything else will happen automagically 😎

<br/>

### Logs

---

You can see realtime logs from your website by running

```sh
npm run logs
```

<br/>

### Demo

---

https://www.velsa.net

<br/>

### Acknowledgments

---

Based on [Fruition](https://fruitionsite.com), which is no longer maintained 😕

Lots of thanks to [@DudeThatsErin](https://github.com/DudeThatsErin) and her [code snippet](https://github.com/stephenou/fruitionsite/issues/258#issue-1929516345).
