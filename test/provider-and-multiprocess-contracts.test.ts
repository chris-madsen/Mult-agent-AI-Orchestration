import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { makeVertexRagRetrievalPort } from '../src/adapters/vertex-rag.js';
import { makeAsyncFileMemoryArchive } from '../src/adapters/file-memory-archive.js';
import { makeEpisodeId, type SessionEpisode } from '../src/domain/memory.js';
import { defaultLocalPolicy } from '../src/domain/policy.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';
import { ok, type Result } from '../src/domain/result.js';
import type { HttpPort } from '../src/application/ports.js';

const value = <T, E>(result: Result<T, E>): T => {
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(String(result.error));
  return result.value;
};
const ws = value(makeWorkspaceId('contract-providers'));
test('DBC-07 Vertex cloud denial makes zero outbound calls', async () => {
  let requests = 0;
  const http: HttpPort = { request: () => { requests += 1; return Effect.succeed(ok({status:200,body:{}})); } };
  const provider = makeVertexRagRetrievalPort({
    project:'ace-dev',location:'us-central1',corpusId:'abc',policy:defaultLocalPolicy(ws),
    accessToken:()=> 'irrelevant-token',http,
  });
  const result = await Effect.runPromise(provider.search({workspaceId:ws,query:'architecture',topK:3}));
  assert.equal(result._tag,'Err');
  assert.equal(requests,0);
});
test('Vertex v1beta1 retrieval uses real retrieveContexts wire shape and provenance', async () => {
  const http: HttpPort = { request: (req) => {
    assert.match(req.url,/us-central1:retrieveContexts$/);
    assert.equal((req.body?.query as { text?:string }).text,'architecture');
    const store=req.body?.vertexRagStore as { ragResources: readonly {ragCorpus:string}[] };
    assert.match(store.ragResources[0]?.ragCorpus??'',/ragCorpora\/abc$/);
    return Effect.succeed(ok({status:200,body:{contexts:{contexts:[{sourceUri:'gs://docs/adr.md',text:'ADR: candidate search'}]}}}));
  }};
  const provider=makeVertexRagRetrievalPort({
    project:'ace-dev',location:'us-central1',corpusId:'abc',
    policy:{...defaultLocalPolicy(ws),cloudOptIn:true,allowedCloudProviders:['vertex']},
    accessToken:()=> 'token',http,
  });
  const result=value(await Effect.runPromise(provider.search({workspaceId:ws,query:'architecture',topK:3})));
  assert.equal(result[0]?.citation,'gs://docs/adr.md');
  assert.equal(result[0]?.freshness,'unknown');
});
test('DBC-11 independent archive instances keep shared blobs through simultaneous deletion', async () => {
  const root=await mkdtemp(join(tmpdir(),'ace-process-archive-'));
  const a=await makeAsyncFileMemoryArchive(root);
  const b=await makeAsyncFileMemoryArchive(root);
  const bytes=Buffer.from('identical session source\n');
  const hash=createHash('sha256').update(bytes).digest('hex') as SessionEpisode['contentDigest'];
  const ep=(id:string):SessionEpisode=>({
    episodeId:value(makeEpisodeId(id)),workspaceId:ws,sessionId:id,sourcePointer:'codex://'+id,
    contentDigest:hash,content:bytes,searchText:'identical source',tombstoned:false,
    occurredAtMs:1000,importedAtMs:1001,
  });
  const x=ep('a');const y=ep('b');
  const imports=await Promise.all([a.importEpisode(x),b.importEpisode(y)]);
  imports.forEach((r)=>assert.equal(r._tag,'Ok'));
  const deleted=await Promise.all([a.deleteEpisode(x.episodeId),b.readEpisode(y.episodeId)]);
  assert.equal(deleted[0]._tag,'Ok');
  assert.equal(deleted[1]._tag,'Ok');
  assert.deepEqual(Buffer.from(value(await b.readEpisode(y.episodeId)).content),bytes);
});
