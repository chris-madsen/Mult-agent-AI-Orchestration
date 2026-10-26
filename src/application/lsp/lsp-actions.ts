export type LspDocumentAction =
  | {
    readonly type: 'didOpen';
    readonly repoPath: string;
    readonly languageId: string;
    readonly version: number;
    readonly text: string;
  }
  | {
    readonly type: 'didChange';
    readonly repoPath: string;
    readonly version: number;
    readonly text: string;
  }
  | {
    readonly type: 'didClose';
    readonly repoPath: string;
  };

export interface LspActionPort {
  readonly applyAction: (action: LspDocumentAction) => Promise<void>;
}
