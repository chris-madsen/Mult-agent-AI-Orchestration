import { extname } from 'node:path';

export interface StructuralLanguage {
  readonly language: string;
  readonly extensions: readonly string[];
}

const languages: readonly StructuralLanguage[] = [
  { language: 'bash', extensions: ['.bash', '.sh'] },
  { language: 'c', extensions: ['.c', '.h'] },
  { language: 'cpp', extensions: ['.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx'] },
  { language: 'csharp', extensions: ['.cs'] },
  { language: 'css', extensions: ['.css'] },
  { language: 'go', extensions: ['.go'] },
  { language: 'hcl', extensions: ['.hcl', '.tf'] },
  { language: 'html', extensions: ['.html', '.htm'] },
  { language: 'java', extensions: ['.java'] },
  { language: 'javascript', extensions: ['.cjs', '.js', '.jsx', '.mjs'] },
  { language: 'json', extensions: ['.json'] },
  { language: 'kotlin', extensions: ['.kt', '.kts'] },
  { language: 'lua', extensions: ['.lua'] },
  { language: 'nix', extensions: ['.nix'] },
  { language: 'php', extensions: ['.php'] },
  { language: 'python', extensions: ['.py'] },
  { language: 'ruby', extensions: ['.rb'] },
  { language: 'rust', extensions: ['.rs'] },
  { language: 'scala', extensions: ['.scala'] },
  { language: 'solidity', extensions: ['.sol'] },
  { language: 'swift', extensions: ['.swift'] },
  { language: 'tsx', extensions: ['.tsx'] },
  { language: 'typescript', extensions: ['.ts'] },
  { language: 'yaml', extensions: ['.yaml', '.yml'] },
];

const byExtension = new Map(
  languages.flatMap((entry) => entry.extensions.map((extension) => [extension, entry] as const)),
);

export const supportedStructuralLanguages = (): readonly StructuralLanguage[] => languages;

export const structuralLanguageForPath = (repoPath: string): StructuralLanguage | undefined =>
  byExtension.get(extname(repoPath).toLocaleLowerCase());

export const structuralExtensions = (): readonly string[] => [...byExtension.keys()].sort();
