const blobs = new Map([['shared-digest', Buffer.from('immutable source bytes')]]);
export const referenceCounts = new Map([['shared-digest', 2]]);
export const readBlob = (digest) => blobs.get(digest);
export function removeBlobIfUnreferenced(digest) {
  blobs.delete(digest);
}
