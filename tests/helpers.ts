import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Downloader, MaterializedPack } from '../src/types';
import { materializeFullPack, applyDelta } from '../src/content/resolver';
import { parseRawPack } from '../src/content/parser';
import { sha256Hex } from '../src/content/checksum';
import { ContentRepository } from '../src/storage/repository';
import { ContentService } from '../src/services/contentService';
import seedPackV1 from '../materials/content-pack-v1.json';
import type { FullPack } from '../src/types';

export const DB_NAME = 'rights-pocket-guide';

export function deleteDatabase(): Promise<void> {
  return new Promise((resolvePromise) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolvePromise();
    request.onerror = () => resolvePromise();
    request.onblocked = () => resolvePromise();
  });
}

export function seedPack(): MaterializedPack {
  return materializeFullPack(seedPackV1 as FullPack);
}

export function v2Path(): string {
  return resolve(__dirname, '..', 'public', 'content-pack-v2.json');
}

export function loadV2Bytes(): Uint8Array {
  const buf = readFileSync(v2Path());
  return new Uint8Array(buf);
}

export async function expectedV2Checksum(): Promise<string> {
  return sha256Hex(loadV2Bytes());
}

export function materializeV2(
  base: MaterializedPack,
): MaterializedPack {
  const raw = parseRawPack(new TextDecoder().decode(loadV2Bytes()));
  if (!('changes' in raw)) {
    throw new Error('v2 fixture should be a delta pack');
  }
  return applyDelta(base, raw);
}

export async function createRepository(): Promise<ContentRepository> {
  await deleteDatabase();
  return ContentRepository.open();
}

export async function createService(
  seed: MaterializedPack = seedPack(),
): Promise<{ service: ContentService; repository: ContentRepository }> {
  const repository = await createRepository();
  const service = new ContentService(repository);
  await service.initialize(seed);
  return { service, repository };
}

export function bytesDownloader(bytes: Uint8Array): Downloader {
  return () => Promise.resolve(bytes);
}

export function rejectingDownloader(message: string): Downloader {
  return () => Promise.reject(new Error(message));
}

export function abortingDownloader(signal: AbortSignal): Downloader {
  return () =>
    new Promise<Uint8Array>((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
}
