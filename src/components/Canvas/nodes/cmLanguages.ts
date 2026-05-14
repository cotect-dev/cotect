import type { Extension } from '@codemirror/state'
import { StreamLanguage } from '@codemirror/language'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { css } from '@codemirror/lang-css'
import { less } from '@codemirror/lang-less'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { html } from '@codemirror/lang-html'
import { markdown } from '@codemirror/lang-markdown'
import { go } from '@codemirror/lang-go'
import { cpp } from '@codemirror/lang-cpp'
import { java } from '@codemirror/lang-java'
import { yaml } from '@codemirror/lang-yaml'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { php } from '@codemirror/lang-php'
import { sass } from '@codemirror/lang-sass'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { lua } from '@codemirror/legacy-modes/mode/lua'
import { swift } from '@codemirror/legacy-modes/mode/swift'
import { kotlin, csharp, dart, scala } from '@codemirror/legacy-modes/mode/clike'
import { diff } from '@codemirror/legacy-modes/mode/diff'
import { protobuf } from '@codemirror/legacy-modes/mode/protobuf'
import { nginx } from '@codemirror/legacy-modes/mode/nginx'

export function getLanguageExt(filePath: string): Extension | null {
  const ext = filePath.match(/\.([^./]+)$/)?.[1]?.toLowerCase()
  const basename = filePath.split('/').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'mts':
    case 'cts':
      return javascript({ typescript: true, jsx: ext === 'tsx' })
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return javascript({ jsx: ext === 'jsx' })
    case 'json':
    case 'jsonc':
      return json()
    case 'css':
      return css()
    case 'less':
      return less()
    case 'scss':
    case 'sass':
      return sass({ indented: ext === 'sass' })
    case 'py':
    case 'pyw':
    case 'pyi':
      return python()
    case 'rs':
      return rust()
    case 'go':
      return go()
    case 'c':
    case 'h':
    case 'cpp':
    case 'cxx':
    case 'cc':
    case 'hpp':
    case 'hxx':
      return cpp()
    case 'java':
      return java()
    case 'kt':
    case 'kts':
      return StreamLanguage.define(kotlin)
    case 'cs':
      return StreamLanguage.define(csharp)
    case 'dart':
      return StreamLanguage.define(dart)
    case 'scala':
    case 'sc':
      return StreamLanguage.define(scala)
    case 'html':
    case 'htm':
    case 'svelte':
    case 'vue':
      return html()
    case 'xml':
    case 'svg':
    case 'xsl':
    case 'xslt':
    case 'plist':
      return xml()
    case 'md':
    case 'mdx':
    case 'markdown':
      return markdown()
    case 'yaml':
    case 'yml':
      return yaml()
    case 'toml':
      return StreamLanguage.define(toml)
    case 'sql':
      return sql()
    case 'php':
      return php()
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'fish':
      return StreamLanguage.define(shell)
    case 'rb':
    case 'rake':
    case 'gemspec':
      return StreamLanguage.define(ruby)
    case 'lua':
      return StreamLanguage.define(lua)
    case 'swift':
      return StreamLanguage.define(swift)
    case 'proto':
      return StreamLanguage.define(protobuf)
    case 'diff':
    case 'patch':
      return StreamLanguage.define(diff)
    case 'conf':
      if (basename.startsWith('nginx')) return StreamLanguage.define(nginx)
      return null
    default:
      if (basename === 'dockerfile' || basename.startsWith('dockerfile.'))
        return StreamLanguage.define(dockerFile)
      if (basename === 'gemfile' || basename === 'rakefile' || basename === 'vagrantfile')
        return StreamLanguage.define(ruby)
      return null
  }
}
