import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const CLI_PATH = join(REPO_ROOT, 'dist/cli/index.js')

test('notion-mirror-generator init-mirror scaffolds the reusable mirror template with branding, backup scripts, and deploy config', async () => {
  const workdir = await mkdtemp(join(tmpdir(), 'notion-mirror-generator-test-'))
  const projectName = 'data/sites/sample-mirror'

  const child = spawn(
    'node',
    [CLI_PATH, 'init-mirror', projectName],
    {
      cwd: workdir,
      env: {
        ...process.env,
        NOTION_MIRROR_CLI_DEBUG: '1',
        NOTION_MIRROR_CLI_ANSWERS: JSON.stringify({
          packageJsonName: 'sample-mirror',
          domainName: 'mirror.example.com',
          rootPageId: 'root-page-id',
          siteName: 'Mirror Example',
          siteDescription: 'Reusable Notion mirror',
          notionWorkspaceSlug: 'mirror-workspace',
          googleTagId: 'G-EXAMPLE123',
          shortLinkRedirectStatus: '301',
          shortLinksJson: JSON.stringify({
            '/start': 'https://mirror.example.com/welcome',
          }),
          brandName: 'Example Brand',
          brandUrl: 'https://brand.example.com',
          brandLogoUrl: 'https://brand.example.com/logo.png',
          brandThemeColor: '#1d4ed8',
          footerOwnerName: 'Ops Team',
          footerOwnerUrl: 'https://t.me/example_ops',
          footerSiteLabel: 'brand.example.com',
          footerSiteUrl: 'https://brand.example.com',
          confirmGenerate: true,
        }),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )

  const output = []
  const collect = (chunk) => {
    output.push(chunk.toString())
  }

  child.stdout.on('data', collect)
  child.stderr.on('data', collect)

  const exitCode = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`Mirror CLI test timed out.\n\n${output.join('')}`))
    }, 15000)

    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })

    child.on('close', (code) => {
      clearTimeout(timeout)
      resolve(code)
    })
  })

  assert.equal(exitCode, 0, output.join(''))

  const scaffoldDir = join(workdir, projectName)
  const packageJson = JSON.parse(await readFile(join(scaffoldDir, 'package.json'), 'utf8'))
  const wranglerConfig = await readFile(join(scaffoldDir, 'wrangler.toml'), 'utf8')
  const deployScript = await readFile(join(scaffoldDir, 'deploy.sh'), 'utf8')
  const siteConfig = await readFile(join(scaffoldDir, 'src/config.ts'), 'utf8')
  const shortLinksConfig = await readFile(join(scaffoldDir, 'src/short-links.ts'), 'utf8')
  const readme = await readFile(join(scaffoldDir, 'README.md'), 'utf8')
  const setupSkill = await readFile(
    join(scaffoldDir, '.codex/skills/setup-notion-mirror/SKILL.md'),
    'utf8',
  )

  assert.equal(packageJson.name, 'sample-mirror')
  assert.equal(packageJson.scripts.setup, 'bun run scripts/setup.ts')
  assert.equal(packageJson.scripts.backup, 'bun run scripts/backup-site.ts')
  assert.equal(packageJson.scripts['backup:workspace'], 'bun run scripts/backup-site.ts --workspace')
  assert.equal(packageJson.scripts['serve:local'], 'bun run scripts/serve-local.ts')
  assert.equal(packageJson.dependencies?.['notion-mirror-generator'], undefined)
  assert.deepEqual(Object.keys(packageJson.dependencies ?? {}).sort(), ['hono'])
  assert.match(wranglerConfig, /name = "sample-mirror-notion-proxy"/)
  assert.match(wranglerConfig, /pattern = "mirror\.example\.com"/)
  assert.match(wranglerConfig, /ROOT_PAGE_ID = "root-page-id"/)
  assert.match(wranglerConfig, /HIDE_MOBILE_COVER_IMAGES = "false"/)
  assert.match(wranglerConfig, /ALWAYS_USE_SITE_LOGO_FAVICON = "false"/)
  assert.match(wranglerConfig, /bucket_name = "sample-mirror-notion-images"/)
  assert.match(deployScript, /SITE_URL="https:\/\/mirror\.example\.com"/)
  assert.match(siteConfig, /const BRAND_NAME = "Example Brand"/)
  assert.match(siteConfig, /const BRAND_THEME_COLOR = "#1d4ed8"/)
  assert.match(siteConfig, /hideMobileCoverImages: env\.HIDE_MOBILE_COVER_IMAGES === 'true'/)
  assert.match(siteConfig, /alwaysUseSiteLogoFavicon: env\.ALWAYS_USE_SITE_LOGO_FAVICON === 'true'/)
  assert.match(shortLinksConfig, /301 \| 302 \| 307/)
  assert.match(readme, /# mirror\.example\.com/)
  assert.match(readme, /data\/sites\/sample-mirror/)
  assert.match(readme, /bun run backup/)
  assert.match(readme, /bun run serve:local/)
  assert.match(readme, /setup-notion-mirror/)
  assert.match(setupSkill, /bun run setup/)
  assert.match(setupSkill, /bun run warm:notion/)

  await rm(workdir, { recursive: true, force: true })
})

test('repo ships the setup-notion-mirror skill manual', async () => {
  const skill = await readFile(join(REPO_ROOT, '.codex/skills/setup-notion-mirror/SKILL.md'), 'utf8')

  assert.match(skill, /Notion/i)
  assert.match(skill, /Cloudflare/i)
  assert.match(skill, /preferences/i)
  assert.match(skill, /init-mirror/)
})
