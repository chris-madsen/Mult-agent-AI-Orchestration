import type { SemanticAnalysisPort } from '../ports.js';

export type ManagedSemanticAnalysisPort = SemanticAnalysisPort & { readonly close: () => void };

interface Entry {
  readonly port: ManagedSemanticAnalysisPort;
  references: number;
}

export interface LspServerRegistry {
  readonly acquire: (key: string, factory: () => ManagedSemanticAnalysisPort) => ManagedSemanticAnalysisPort;
  readonly release: (key: string) => void;
  readonly closeAll: () => void;
}

export const makeLspServerRegistry = (): LspServerRegistry => {
  const entries = new Map<string, Entry>();
  return {
    acquire: (key, factory) => {
      const existing = entries.get(key);
      if (existing !== undefined) {
        existing.references += 1;
        return existing.port;
      }
      const port = factory();
      entries.set(key, { port, references: 1 });
      return port;
    },
    release: (key) => {
      const entry = entries.get(key);
      if (entry === undefined) return;
      entry.references -= 1;
      if (entry.references > 0) return;
      entries.delete(key);
      entry.port.close();
    },
    closeAll: () => {
      for (const entry of entries.values()) entry.port.close();
      entries.clear();
    },
  };
};
