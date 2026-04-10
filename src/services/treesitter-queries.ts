export interface LanguageConfig {
  extensions: string[]
}

const typescriptConfig: LanguageConfig = {
  extensions: ['.ts', '.tsx'],
}

const javascriptConfig: LanguageConfig = {
  extensions: ['.js', '.jsx'],
}

export const LANGUAGE_CONFIGS: LanguageConfig[] = [
  typescriptConfig,
  javascriptConfig,
]

export function getConfigForFile(filename: string): LanguageConfig | null {
  const ext = filename.slice(filename.lastIndexOf('.'))
  return LANGUAGE_CONFIGS.find((c) => c.extensions.includes(ext)) ?? null
}
