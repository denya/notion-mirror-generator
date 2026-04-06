import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ENV_FILES = [
  { example: '.env.example', target: '.env' },
  { example: '.dev.vars.example', target: '.dev.vars' },
]

for (const file of ENV_FILES) {
  const source = resolve(file.example)
  const target = resolve(file.target)

  if (!existsSync(target)) {
    copyFileSync(source, target)
    console.log(`Created ${file.target} from ${file.example}`)
  }
}

const notionApiKey = process.env.NOTION_API_KEY
if (notionApiKey) {
  for (const file of ENV_FILES.map((entry) => entry.target)) {
    injectEnvValue(file, 'NOTION_API_KEY', notionApiKey)
  }

  console.log('Copied NOTION_API_KEY into .env and .dev.vars')
} else {
  console.log('NOTION_API_KEY is not set in the shell. Fill it in manually in .env and .dev.vars.')
}

console.log('\nNext steps:')
console.log('1. Review wrangler.toml and confirm the worker name, domain route, and bucket name.')
console.log('2. Run ./deploy.sh to create Cloudflare resources, set the Notion secret, and deploy.')
console.log('3. Run bun run warm:notion after the first deploy if you want to prefill the cache.')

function injectEnvValue(filename: string, key: string, value: string) {
  const current = readFileSync(filename, 'utf8')
  const nextLine = `${key}=${value}`
  const pattern = new RegExp(`^${key}=.*$`, 'm')
  const next = pattern.test(current) ? current.replace(pattern, nextLine) : `${current.trimEnd()}\n${nextLine}\n`
  writeFileSync(filename, next)
}
