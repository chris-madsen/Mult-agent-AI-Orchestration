import { createHash } from 'node:crypto';
import { exportCodexHistory } from '../dist/adapters/codex-session-history.js';
import { makeAsyncFileMemoryArchive } from '../dist/adapters/file-memory-archive.js';

const [operation, root, subject, payload] = process.argv.slice(2);

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
};

try {
  if (operation === 'export') {
    const history = await exportCodexHistory(subject, 'memory-process-workspace', 1_700_000_000_000);
    if (history._tag === 'Err') throw new Error(history.error.message);
    process.stdout.write(JSON.stringify({
      sourceDigest: history.value.sourceDigest,
      episodes: history.value.episodes.map((episode) => ({ episodeId: episode.episodeId, sourcePointer: episode.sourcePointer })),
    }) + '\n');
  } else if (operation === 'import' || operation === 'read' || operation === 'delete') {
    const archive = await makeAsyncFileMemoryArchive(root);
    if (operation === 'import') {
      const episode = JSON.parse(payload);
      episode.content = Buffer.from(episode.contentBase64, 'base64');
      delete episode.contentBase64;
      const result = await archive.importEpisode(episode);
      if (result._tag === 'Err') throw new Error(result.error.code + ': ' + result.error.message);
      process.stdout.write(JSON.stringify({ created: result.value.created, episodeId: result.value.episode.episodeId }) + '\n');
    } else if (operation === 'read') {
      const result = await archive.readEpisode(subject);
      if (result._tag === 'Err') {
        process.stdout.write(JSON.stringify({ status: 'error', code: result.error.code }) + '\n');
      } else {
        process.stdout.write(JSON.stringify({
          status: 'ok',
          episodeId: result.value.episodeId,
          contentDigest: result.value.contentDigest,
          contentSha256: createHash('sha256').update(result.value.content).digest('hex'),
        }) + '\n');
      }
    } else {
      const result = await archive.deleteEpisode(subject);
      if (result._tag === 'Err') throw new Error(result.error.code + ': ' + result.error.message);
      process.stdout.write(JSON.stringify({ status: 'deleted', episodeId: subject }) + '\n');
    }
  } else {
    throw new Error('unknown memory worker operation');
  }
} catch (error) {
  fail(error instanceof Error ? error.message : 'unknown error');
}
