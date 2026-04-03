export interface LanguageConfig {
  extensions: string[]
  grammarPath: string
  declarationQuery: string
  importQuery: string
}

const typescriptConfig: LanguageConfig = {
  extensions: ['.ts', '.tsx'],
  grammarPath: '/tree-sitter-typescript.wasm',
  declarationQuery: `
    (function_declaration name: (identifier) @name) @decl
    (export_statement declaration: (function_declaration name: (identifier) @name)) @decl
    (lexical_declaration
      (variable_declarator
        name: (identifier) @name
        value: (arrow_function)) @decl)
    (export_statement
      declaration: (lexical_declaration
        (variable_declarator
          name: (identifier) @name
          value: (arrow_function))) @decl)
    (class_declaration name: (type_identifier) @name) @decl
    (export_statement declaration: (class_declaration name: (type_identifier) @name)) @decl
    (method_definition name: (property_identifier) @method_name) @method
  `,
  importQuery: `
    (import_statement source: (string (string_fragment) @source))
  `,
}

const javascriptConfig: LanguageConfig = {
  extensions: ['.js', '.jsx'],
  grammarPath: '/tree-sitter-javascript.wasm',
  declarationQuery: `
    (function_declaration name: (identifier) @name) @decl
    (export_statement declaration: (function_declaration name: (identifier) @name)) @decl
    (lexical_declaration
      (variable_declarator
        name: (identifier) @name
        value: (arrow_function)) @decl)
    (export_statement
      declaration: (lexical_declaration
        (variable_declarator
          name: (identifier) @name
          value: (arrow_function))) @decl)
    (class_declaration name: (identifier) @name) @decl
    (export_statement declaration: (class_declaration name: (identifier) @name)) @decl
    (method_definition name: (property_identifier) @method_name) @method
  `,
  importQuery: `
    (import_statement source: (string (string_fragment) @source))
    (call_expression
      function: (identifier) @fn (#eq? @fn "require")
      arguments: (arguments (string (string_fragment) @source)))
  `,
}

export const LANGUAGE_CONFIGS: LanguageConfig[] = [
  typescriptConfig,
  javascriptConfig,
]

export function getConfigForFile(filename: string): LanguageConfig | null {
  const ext = filename.slice(filename.lastIndexOf('.'))
  return LANGUAGE_CONFIGS.find((c) => c.extensions.includes(ext)) ?? null
}
