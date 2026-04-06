import chalk from 'chalk'
import path from 'path'
import { copyFilesToSDK } from './copy-files'
import { getMirrorParserConfig } from './mirror-config'
import { promptConfirm } from './prompt-helpers'
import { resolveTemplateRoot } from './template-root'

export async function initMirror(projectName: string) {
  const targetDir = path.join(process.cwd(), projectName)
  const parserConfig = await getMirrorParserConfig(projectName)
  const templateDir = path.join(resolveTemplateRoot(process.argv[1]), 'templates', 'notion-mirror')

  console.log(`\n🎬 Ready to generate Notion mirror in: ${targetDir}`)
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
    originDir: templateDir,
    sdkDir: targetDir,
  })

  console.log(`\n🎉 Done! Your mirror repo is in ${targetDir}`)
  console.log(`\nRun ${chalk.bold(`cd ${projectName}`)} and ${chalk.bold('bun install')}`)
  console.log(`Use ${chalk.bold('bun run setup')} to prepare local env files and deployment hints.`)
  console.log(`Then review ${chalk.bold('wrangler.toml')} and run ${chalk.bold('./deploy.sh')}.`)
}
