export function isTestFile(name: string): boolean {
  const lower = name.toLowerCase()
  if (/\.(test|spec)\.\w+$/.test(lower)) return true
  if (/[_-]test\.\w+$/.test(lower)) return true
  if (/^tests?\.\w+$/.test(lower)) return true
  if (/^(jest|vitest|karma|cypress|playwright)[.-]/.test(lower)) return true
  return false
}
