import { referenceCounts, removeBlobIfUnreferenced } from './blob-store.mjs';
const episodes = new Map([
  ['episode-a', { digest: 'shared-digest', tombstoned: false }],
  ['episode-b', { digest: 'shared-digest', tombstoned: false }],
]);
export function deleteEpisode(episodeId) {
  const episode = episodes.get(episodeId);
  if (episode === undefined) return false;
  episode.tombstoned = true;
  episodes.delete(episodeId);
  removeBlobIfUnreferenced(episode.digest);
  return true;
}
export const getEpisode = (episodeId) => episodes.get(episodeId);
