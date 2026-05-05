#!/usr/bin/env node
import { program } from 'commander'
import { version } from '../../package.json'
import { initMirror } from './init-mirror'

program
  .name('notion-mirror-generator')
  .description('Generate reusable Notion mirror projects for Cloudflare Workers.')
  .version(version)

program
  .command('init-mirror')
  .description('Initialize a reusable Notion mirror repo from the modern template')
  .argument('<project-name>', 'local project/repo name')
  .action(initMirror)

program.parse()
