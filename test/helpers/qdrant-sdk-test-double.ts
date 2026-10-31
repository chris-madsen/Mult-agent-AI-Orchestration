import { Effect } from 'effect';
import type { QdrantClient } from '@qdrant/js-client-rest';
import type { HttpPort } from '../../src/application/ports.js';

const makeRequest = async (
  http: HttpPort,
  request: Parameters<HttpPort['request']>[0],
): Promise<unknown> => {
  const result = await Effect.runPromise(http.request(request));
  if (result._tag === 'Err') throw new Error(result.error.message);
  if (result.value.status < 200 || result.value.status >= 300) {
    throw Object.assign(new Error(`Qdrant test double request failed: HTTP ${result.value.status}`), {
      status: result.value.status,
    });
  }
  const body = result.value.body;
  if (typeof body === 'object' && body !== null && !Array.isArray(body)
    && 'result' in body) {
    return (body as { result?: unknown }).result;
  }
  return body;
};

const makeMutationRequest = async (
  http: HttpPort,
  request: Parameters<HttpPort['request']>[0],
): Promise<unknown> => {
  const result = await makeRequest(http, request);
  // Older deterministic fixtures used { result: true } for successful raw
  // mutations. The official SDK returns UpdateResult, so the SDK-shaped test
  // double must expose the SDK contract rather than leak that legacy fixture.
  return result === true ? { status: 'completed' } : result;
};

export const makeQdrantSdkTestDouble = (
  http: HttpPort,
  baseUrl = 'http://127.0.0.1:6333',
): QdrantClient => {
  const collectionUrl = (collection: string): string =>
    `${baseUrl}/collections/${encodeURIComponent(collection)}`;
  return {
    getCollections: () => makeRequest(http, { method: 'GET', url: `${baseUrl}/collections` }),
    getCollection: (collection: string) => makeRequest(http, { method: 'GET', url: collectionUrl(collection) }),
    createCollection: (collection: string, body: unknown) => makeRequest(http, {
      method: 'PUT',
      url: collectionUrl(collection),
      body: body as Readonly<Record<string, unknown>>,
    }),
    getAliases: () => makeRequest(http, { method: 'GET', url: `${baseUrl}/aliases` }),
    updateCollectionAliases: (body: unknown) => makeRequest(http, {
      method: 'POST',
      url: `${baseUrl}/collections/aliases`,
      body: body as Readonly<Record<string, unknown>>,
    }),
    query: (collection: string, body: unknown) => makeRequest(http, {
      method: 'POST',
      url: `${collectionUrl(collection)}/points/query`,
      body: body as Readonly<Record<string, unknown>>,
    }),
    upsert: (collection: string, body: unknown) => makeMutationRequest(http, {
      method: 'PUT',
      url: `${collectionUrl(collection)}/points?wait=true`,
      body: body as Readonly<Record<string, unknown>>,
    }),
    delete: (collection: string, body: unknown) => makeMutationRequest(http, {
      method: 'POST',
      url: `${collectionUrl(collection)}/points/delete?wait=true`,
      body: body as Readonly<Record<string, unknown>>,
    }),
    count: (collection: string, body: unknown) => makeRequest(http, {
      method: 'POST',
      url: `${collectionUrl(collection)}/points/count`,
      body: body as Readonly<Record<string, unknown>>,
    }),
    scroll: (collection: string, body: unknown) => makeRequest(http, {
      method: 'POST',
      url: `${collectionUrl(collection)}/points/scroll`,
      body: body as Readonly<Record<string, unknown>>,
    }),
  } as unknown as QdrantClient;
};
