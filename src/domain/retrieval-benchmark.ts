import type { SourceRange } from './retrieval.js';

export interface BenchmarkCandidateRange {
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn?: number;
  readonly endColumn?: number;
}

export type RetrievalBenchmarkStage = 'dense' | 'sparse' | 'fused' | 'working_context' | 'reranked' | 'delivered';

export interface RetrievalBenchmarkCandidateIdentity {
  readonly runtimeCandidateId: string;
  readonly canonicalCandidateId?: string;
  readonly repoPath: string;
  readonly sourceDigest: string;
  readonly range: SourceRange;
}

export interface RetrievalBenchmarkTraceEvent {
  readonly requestId: string;
  readonly stage: RetrievalBenchmarkStage;
  readonly candidates: readonly RetrievalBenchmarkCandidateIdentity[];
  readonly durationMs: number;
  readonly providerIdentities?: Readonly<Record<string, string>>;
}

export interface RetrievalBenchmarkTraceSink {
  readonly record: (event: RetrievalBenchmarkTraceEvent) => void;
}

export const noopRetrievalBenchmarkTrace: RetrievalBenchmarkTraceSink = { record: () => undefined };

export interface RetrievalBenchmarkTraceCollector extends RetrievalBenchmarkTraceSink {
  readonly events: readonly RetrievalBenchmarkTraceEvent[];
  readonly stageRanksFor: (requestId: string) => {
    readonly dense: readonly string[];
    readonly sparse: readonly string[];
    readonly fused: readonly string[];
    readonly workingContext: readonly string[];
    readonly reranked: readonly string[];
    readonly delivered: readonly string[];
  };
}

export const createRetrievalBenchmarkTraceCollector = (
  repositoryId: string,
): RetrievalBenchmarkTraceCollector => {
  const recorded: RetrievalBenchmarkTraceEvent[] = [];
  const stageKey = (stage: RetrievalBenchmarkStage): keyof ReturnType<RetrievalBenchmarkTraceCollector['stageRanksFor']> => {
    if (stage === 'working_context') return 'workingContext';
    return stage;
  };
  return {
    record: (event) => { recorded.push(event); },
    get events() { return recorded; },
    stageRanksFor: (requestId) => {
      const result = {
        dense: [] as string[],
        sparse: [] as string[],
        fused: [] as string[],
        workingContext: [] as string[],
        reranked: [] as string[],
        delivered: [] as string[],
      };
      for (const event of recorded.filter((item) => item.requestId === requestId)) {
        result[stageKey(event.stage)] = event.candidates.map((candidate) => candidate.canonicalCandidateId
          ?? canonicalBenchmarkCandidateId(repositoryId, candidate.repoPath, candidate.sourceDigest, candidate.range));
      }
      return result;
    },
  };
};

/**
 * Runtime candidate ids include workspace identity and therefore cannot be
 * used as labels across independent benchmark workspaces. This id binds only
 * immutable source identity and the exact structural range.
 */
export const sha256 = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  const bitLength = bytes.length * 8;
  const paddedLength = ((bytes.length + 9 + 63) >> 6) << 6;
  const message = new Uint8Array(paddedLength);
  message.set(bytes);
  message[bytes.length] = 0x80;
  const view = new DataView(message.buffer);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const rotr = (word: number, bits: number): number => (word >>> bits) | (word << (32 - bits));
  for (let offset = 0; offset < paddedLength; offset += 64) {
    const words = new Uint32Array(64);
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotr(words[index - 15] as number, 7) ^ rotr(words[index - 15] as number, 18) ^ ((words[index - 15] as number) >>> 3);
      const s1 = rotr(words[index - 2] as number, 17) ^ rotr(words[index - 2] as number, 19) ^ ((words[index - 2] as number) >>> 10);
      words[index] = (((words[index - 16] as number) + s0 + (words[index - 7] as number) + s1) >>> 0);
    }
    let a = h0; let b = h1; let c = h2; let d = h3; let e = h4; let f = h5; let g = h6; let h = h7;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choose + (constants[index] as number) + (words[index] as number)) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((word) => word.toString(16).padStart(8, '0')).join('');
};

export const canonicalBenchmarkCandidateId = (
  repositoryId: string,
  repoPath: string,
  sourceDigest: string,
  range: BenchmarkCandidateRange,
): string => sha256([
  repositoryId,
  repoPath,
  sourceDigest,
  String(range.startLine),
  String(range.startColumn ?? ''),
  String(range.endLine),
  String(range.endColumn ?? ''),
].join('\0'));
