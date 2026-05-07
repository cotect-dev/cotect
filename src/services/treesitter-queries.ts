export type LanguageId = 'typescript' | 'javascript' | 'python' | 'go' | 'rust'

export interface LanguageConfig {
  id: LanguageId
  extensions: string[]
}

const typescriptConfig: LanguageConfig = {
  id: 'typescript',
  extensions: ['.ts', '.tsx'],
}

const javascriptConfig: LanguageConfig = {
  id: 'javascript',
  extensions: ['.js', '.jsx', '.mjs', '.cjs'],
}

const pythonConfig: LanguageConfig = {
  id: 'python',
  extensions: ['.py'],
}

const goConfig: LanguageConfig = {
  id: 'go',
  extensions: ['.go'],
}

const rustConfig: LanguageConfig = {
  id: 'rust',
  extensions: ['.rs'],
}

export const LANGUAGE_CONFIGS: LanguageConfig[] = [
  typescriptConfig,
  javascriptConfig,
  pythonConfig,
  goConfig,
  rustConfig,
]

/** Set of all file extensions we can parse imports from. */
export const PARSEABLE_EXTENSIONS: Set<string> = new Set(
  LANGUAGE_CONFIGS.flatMap((c) => c.extensions),
)

export function getConfigForFile(filename: string): LanguageConfig | null {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  return LANGUAGE_CONFIGS.find((c) => c.extensions.includes(ext)) ?? null
}
