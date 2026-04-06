import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import { copyFilesToSDK } from './copy-files'
import { getParserConfig } from './parser-config'
import { promptConfirm, promptSelect } from './prompt-helpers'
import { resolveTemplateRoot } from './template-root'

export async function initRepo(domain) {
  const sdkDir = path.join(process.cwd(), domain)
  const originDir = resolveTemplateRoot(process.argv[1])
  const parserConfig = await getParserConfig(domain)
  const templates = fs.readdirSync(path.join(originDir, 'templates'))
  const template =
    templates.length > 1
      ? await promptSelect({
          key: 'template',
          message: 'Generate from template:',
          choices: templates.map((t) => ({ name: t, value: t })),
        })
      : templates[0]

  console.log(`\n🎬 Ready to generate NoteHost worker in: ${sdkDir}`)
  const shouldContinue = await promptConfirm({
    key: 'confirmGenerate',
    message: 'Continue?',
    defaultValue: true,
  })
  if (!shouldContinue) {
    console.log('Aborted.')
    return
  }

  console.log('Generating...')

  await copyFilesToSDK({
    parserConfig,
    originDir: path.join(originDir, 'templates', template),
    sdkDir,
  })

  console.log(`\n🎉 Done! Your worker is in`, sdkDir)
  console.log(`\nGo into this directory and run ${chalk.bold('npm install')}`)
  console.log(`Edit ${chalk.bold('src/site-config.ts')} to setup your website.`)
  console.log(`Review ${chalk.bold('wrangler.toml')} and make sure your worker name is correct.`)
  console.log(`And finally run ${chalk.bold('npm run deploy')} to publish your website.`)

  process.exit(0)
}
