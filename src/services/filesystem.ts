import { filesystem } from '@neutralinojs/lib'

export interface FSEntry {
  name: string
  path: string
  isDirectory: boolean
}

interface NeuDirEntry {
  entry: string
  type: string
}

export async function readDirectory(dirPath: string): Promise<FSEntry[]> {
  const entries: NeuDirEntry[] = await filesystem.readDirectory(dirPath)
  return entries
    .filter((e: NeuDirEntry) => e.entry !== '.' && e.entry !== '..')
    .map((e: NeuDirEntry) => ({
      name: e.entry,
      path: `${dirPath}/${e.entry}`,
      isDirectory: e.type === 'DIRECTORY',
    }))
    .sort((a: FSEntry, b: FSEntry) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

export async function readFileContent(filePath: string): Promise<string> {
  return filesystem.readFile(filePath)
}
