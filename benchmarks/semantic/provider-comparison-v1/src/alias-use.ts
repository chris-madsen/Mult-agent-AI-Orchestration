import { persistRecord as saveAlias } from './alias-source.js';

export function callAlias(value: string): string {
  return saveAlias(value);
}
