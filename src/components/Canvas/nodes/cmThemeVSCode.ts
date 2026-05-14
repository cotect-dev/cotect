import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

const background = '#1e1e1e'
const foreground = '#d4d4d4'
const selection = '#264f78'
const cursor = '#aeafad'
const activeLine = '#ffffff0a'
const gutterForeground = '#858585'
const gutterActiveLine = '#c6c6c6'
const lineHighlight = '#2a2d2e'
const tooltipBg = '#252526'
const searchMatch = '#623315'
const searchMatchSelected = '#9e6a03'

const vscodeDarkTheme = EditorView.theme(
  {
    '&': { color: foreground, backgroundColor: background },
    '.cm-content': { caretColor: cursor },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: cursor },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      { backgroundColor: selection },
    '.cm-panels': { backgroundColor: '#252526', color: foreground },
    '.cm-panels.cm-panels-top': { borderBottom: '2px solid #1e1e1e' },
    '.cm-panels.cm-panels-bottom': { borderTop: '2px solid #1e1e1e' },
    '.cm-searchMatch': { backgroundColor: searchMatch, outline: 'none' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: searchMatchSelected },
    '.cm-activeLine': { backgroundColor: activeLine },
    '.cm-selectionMatch': { backgroundColor: '#add6ff26' },
    '&.cm-focused .cm-matchingBracket': {
      backgroundColor: '#0064001a',
      outline: '1px solid #888',
    },
    '&.cm-focused .cm-nonmatchingBracket': { backgroundColor: '#ff000040' },
    '.cm-gutters': { backgroundColor: background, color: gutterForeground, border: 'none' },
    '.cm-activeLineGutter': { backgroundColor: lineHighlight, color: gutterActiveLine },
    '.cm-foldPlaceholder': {
      backgroundColor: 'transparent',
      border: 'none',
      color: '#c5c5c5',
    },
    '.cm-tooltip': { border: '1px solid #454545', backgroundColor: tooltipBg },
    '.cm-tooltip .cm-tooltip-arrow:before': {
      borderTopColor: 'transparent',
      borderBottomColor: 'transparent',
    },
    '.cm-tooltip .cm-tooltip-arrow:after': {
      borderTopColor: tooltipBg,
      borderBottomColor: tooltipBg,
    },
    '.cm-tooltip-autocomplete': {
      '& > ul > li[aria-selected]': { backgroundColor: '#04395e', color: foreground },
    },
  },
  { dark: true },
)

const vscodeDarkHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: '#569cd6' },
  { tag: tags.controlKeyword, color: '#c586c0' },
  { tag: tags.operatorKeyword, color: '#569cd6' },
  { tag: [tags.variableName], color: '#9cdcfe' },
  { tag: [tags.function(tags.variableName)], color: '#dcdcaa' },
  { tag: [tags.definition(tags.variableName)], color: '#9cdcfe' },
  { tag: [tags.definition(tags.function(tags.variableName))], color: '#dcdcaa' },
  { tag: [tags.propertyName], color: '#9cdcfe' },
  { tag: [tags.function(tags.propertyName)], color: '#dcdcaa' },
  { tag: [tags.definition(tags.propertyName)], color: '#9cdcfe' },
  { tag: [tags.typeName, tags.className], color: '#4ec9b0' },
  { tag: [tags.namespace], color: '#4ec9b0' },
  { tag: [tags.macroName], color: '#dcdcaa' },
  { tag: [tags.literal], color: '#569cd6' },
  { tag: [tags.number], color: '#b5cea8' },
  { tag: [tags.string], color: '#ce9178' },
  { tag: [tags.special(tags.string)], color: '#d7ba7d' },
  { tag: [tags.regexp], color: '#d16969' },
  { tag: [tags.escape], color: '#d7ba7d' },
  { tag: [tags.atom, tags.bool], color: '#569cd6' },
  { tag: [tags.self], color: '#569cd6' },
  { tag: [tags.null], color: '#569cd6' },
  { tag: [tags.comment], color: '#6a9955' },
  { tag: [tags.lineComment], color: '#6a9955' },
  { tag: [tags.blockComment], color: '#6a9955' },
  { tag: [tags.docComment], color: '#6a9955' },
  { tag: [tags.operator], color: '#d4d4d4' },
  { tag: [tags.derefOperator], color: '#d4d4d4' },
  { tag: [tags.separator], color: '#d4d4d4' },
  { tag: [tags.punctuation], color: '#d4d4d4' },
  { tag: [tags.paren], color: '#d4d4d4' },
  { tag: [tags.squareBracket], color: '#d4d4d4' },
  { tag: [tags.brace], color: '#ffd700' },
  { tag: [tags.angleBracket], color: '#808080' },
  { tag: [tags.tagName], color: '#569cd6' },
  { tag: [tags.attributeName], color: '#9cdcfe' },
  { tag: [tags.attributeValue], color: '#ce9178' },
  { tag: [tags.annotation], color: '#dcdcaa' },
  { tag: [tags.modifier], color: '#569cd6' },
  { tag: [tags.meta], color: '#569cd6' },
  { tag: [tags.processingInstruction], color: '#569cd6' },
  { tag: [tags.name], color: '#9cdcfe' },
  { tag: [tags.deleted], color: '#ce9178' },
  { tag: [tags.inserted], color: '#b5cea8' },
  { tag: [tags.changed], color: '#569cd6' },
  { tag: tags.constant(tags.name), color: '#4fc1ff' },
  { tag: tags.standard(tags.name), color: '#dcdcaa' },
  { tag: tags.link, color: '#569cd6', textDecoration: 'underline' },
  { tag: tags.url, color: '#3794ff' },
  { tag: tags.heading, fontWeight: 'bold', color: '#569cd6' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.invalid, color: '#f44747' },
])

export const vscodeDark = [vscodeDarkTheme, syntaxHighlighting(vscodeDarkHighlightStyle)]
