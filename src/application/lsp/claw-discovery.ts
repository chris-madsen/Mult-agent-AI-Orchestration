/**
 * Claw Code PR #3016 real LSP server catalog, source-translated from
 * TheArchitectit/claw-code@5e7d7edb8e82782371f8747aca63e63412ccfca6
 * rust/crates/runtime/src/lsp_discovery.rs:75-161, 257-265, 451-486.
 * MIT License: third_party/licenses/claw-MIT.txt. Transport remains official
 * vscode-jsonrpc; none of Claw's bespoke framing is copied.
 */
import { extname } from 'node:path';

export interface KnownLspServer {
  readonly language: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly extensions: readonly string[];
  readonly languageIds: Readonly<Record<string, string>>;
}
const descriptors: readonly KnownLspServer[] = [
  {
    language: 'rust',
    command: 'rust-analyzer',
    args: [],
    extensions: ['.rs'],
    languageIds: { '.rs': 'rust' },
  },
  {
    language: 'c/cpp',
    command: 'clangd',
    args: [],
    extensions: ['.c', '.h', '.cpp', '.hpp'],
    languageIds: { '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.hpp': 'cpp' },
  },
  {
    language: 'python',
    command: 'pyright-langserver',
    args: ['--stdio'],
    extensions: ['.py'],
    languageIds: { '.py': 'python' },
  },
  {
    language: 'go',
    command: 'gopls',
    args: [],
    extensions: ['.go'],
    languageIds: { '.go': 'go' },
  },
  {
    language: 'typescript',
    command: 'typescript-language-server',
    args: ['--stdio'],
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    languageIds: { '.ts': 'typescript', '.tsx': 'typescriptreact', '.js': 'javascript', '.jsx': 'javascriptreact' },
  },
  {
    language: 'java',
    command: 'jdtls',
    args: [],
    extensions: ['.java'],
    languageIds: { '.java': 'java' },
  },
  {
    language: 'ruby',
    command: 'solargraph',
    args: ['stdio'],
    extensions: ['.rb'],
    languageIds: { '.rb': 'ruby' },
  },
  {
    language: 'lua',
    command: 'lua-language-server',
    args: [],
    extensions: ['.lua'],
    languageIds: { '.lua': 'lua' },
  },
  {
    language: 'html',
    command: 'vscode-html-language-server',
    args: ['--stdio'],
    extensions: ['.html', '.htm'],
    languageIds: { '.html': 'html', '.htm': 'html' },
  },
  {
    language: 'css',
    command: 'vscode-css-language-server',
    args: ['--stdio'],
    extensions: ['.css', '.scss', '.less', '.sass'],
    languageIds: { '.css': 'css', '.scss': 'scss', '.less': 'less', '.sass': 'sass' },
  },
  {
    language: 'json',
    command: 'vscode-json-language-server',
    args: ['--stdio'],
    extensions: ['.json', '.jsonc'],
    languageIds: { '.json': 'json', '.jsonc': 'jsonc' },
  },
  {
    language: 'bash',
    command: 'bash-language-server',
    args: ['start'],
    extensions: ['.sh', '.bash', '.zsh'],
    languageIds: { '.sh': 'shellscript', '.bash': 'shellscript', '.zsh': 'shellscript' },
  },
  {
    language: 'yaml',
    command: 'yaml-language-server',
    args: ['--stdio'],
    extensions: ['.yaml', '.yml'],
    languageIds: { '.yaml': 'yaml', '.yml': 'yaml' },
  },
];

export const knownLspServers = (): readonly KnownLspServer[] => descriptors;

export const findKnownLspForFile = (file: string): KnownLspServer | undefined => {
  const suffix = extname(file).toLocaleLowerCase();
  return descriptors.find((entry) => entry.extensions.includes(suffix));
};

/** Uses only verified indexed filenames, never another worktree crawl. */
export const selectInstalledLspForPaths = (
  paths: readonly string[],
  available: (entry: KnownLspServer) => boolean,
): KnownLspServer | undefined => {
  const extensions = paths.map((file) => extname(file).toLocaleLowerCase());
  return descriptors.map((entry) => ({
    entry,
    matches: extensions.filter((ext) => entry.extensions.includes(ext)).length,
  })).filter((candidate) => candidate.matches > 0)
    .sort((a, b) => b.matches - a.matches)
    .map((candidate) => candidate.entry)
    .find(available);
};
