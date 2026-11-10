import type { Result } from '../domain/result.js';
import type { WorkspaceStore } from './ports.js';

export type GoodApplicationDependency = readonly [Result<string, string>, WorkspaceStore];
