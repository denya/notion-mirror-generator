import { confirm, input, select } from '@inquirer/prompts'
import fs from 'fs'

const ANSWERS_ENV_VAR = 'NOTION_MIRROR_CLI_ANSWERS'

type PromptAnswers = Record<string, unknown>

let cachedAnswers: PromptAnswers | null = null

function loadPromptAnswers(): PromptAnswers {
  if (cachedAnswers) {
    return cachedAnswers
  }

  const raw = process.env[ANSWERS_ENV_VAR]
  if (!raw) {
    cachedAnswers = {}
    return cachedAnswers
  }

  const source = raw.trim()
  const json = source.startsWith('{') ? source : fs.readFileSync(source, 'utf8')
  cachedAnswers = JSON.parse(json) as PromptAnswers
  return cachedAnswers
}

function getAnswer<T>(key: string): T | undefined {
  const answers = loadPromptAnswers()
  return answers[key] as T | undefined
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['y', 'yes', 'true', '1'].includes(normalized)) {
      return true
    }

    if (['n', 'no', 'false', '0'].includes(normalized)) {
      return false
    }
  }

  return fallback
}

export async function promptText(params: {
  key: string
  message: string
  defaultValue?: string
}): Promise<string> {
  const provided = getAnswer<string>(params.key)
  if (typeof provided === 'string') {
    return provided
  }

  return input({
    message: params.message,
    default: params.defaultValue,
  })
}

export async function promptConfirm(params: {
  key: string
  message: string
  defaultValue?: boolean
}): Promise<boolean> {
  const provided = getAnswer<boolean | string>(params.key)
  if (provided !== undefined) {
    return toBoolean(provided, params.defaultValue ?? false)
  }

  return confirm({
    message: params.message,
    default: params.defaultValue,
  })
}

export async function promptSelect<T>(params: {
  key: string
  message: string
  choices: Array<{ name: string; value: T }>
}): Promise<T> {
  const provided = getAnswer<T>(params.key)
  if (provided !== undefined) {
    const matchingChoice = params.choices.find((choice) => choice.value === provided)
    if (matchingChoice) {
      return matchingChoice.value
    }
  }

  return select({
    message: params.message,
    choices: params.choices,
  })
}
