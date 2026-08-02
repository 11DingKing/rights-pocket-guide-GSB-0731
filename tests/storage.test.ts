import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { ContentRepository } from '../src/storage/repository';
import { StorageError } from '../src/storage/db';
import { DEFAULT_SETTINGS } from '../src/types';
import type { MaterializedPack, ReadingSettings } from '../src/types';
import { createRepository, deleteDatabase, seedPack, materializeV2 } from './helpers';

let repo: ContentRepository;

beforeEach(async () => {
  repo = await createRepository();
});

function v2Pack(base: MaterializedPack = seedPack()): MaterializedPack {
  return materializeV2(base);
}

describe('ContentRepository', () => {
  it('seeds the first version and reports it active', async () => {
    const seed = seedPack();
    await repo.initialize(seed);
    expect(await repo.getActiveVersion()).toBe(seed.packageVersion);
    const active = await repo.getActivePack();
    expect(active?.packageVersion).toBe(seed.packageVersion);
    expect(Object.keys(active?.articles ?? {}).length).toBe(3);
  });

  it('does not overwrite an existing active version on re-initialize', async () => {
    const seed = seedPack();
    await repo.initialize(seed);
    const modified: MaterializedPack = {
      ...seed,
      articles: { ...seed.articles, ['ART-X']: { id: 'ART-X', title: 'x', body: 'x', legalRef: 'x' } },
    };
    await repo.initialize(modified);
    const active = await repo.getActivePack();
    expect(active?.articles['ART-X']).toBeUndefined();
  });

  it('stages and atomically commits a new version', async () => {
    await repo.initialize(seedPack());
    const next = v2Pack();
    await repo.stage(next);
    expect(await repo.getActiveVersion()).toBe('2026.07.31');
    expect(await repo.getStagedVersion()).toBe('2026.09.01');
    await repo.commit(next);
    expect(await repo.getActiveVersion()).toBe('2026.09.01');
    expect(await repo.getStagedVersion()).toBeNull();
    const active = await repo.getActivePack();
    expect(active?.articles['ART-SERVICE-3']).toBeDefined();
    expect(active?.articles['ART-AID-2']).toBeUndefined();
    expect(active?.withdrawals['ART-AID-2']?.replacementArticleId).toBe('ART-SERVICE-3');
  });

  it('keeps the previous version for rollback after commit', async () => {
    await repo.initialize(seedPack());
    const next = v2Pack();
    await repo.stage(next);
    await repo.commit(next);
    expect(await repo.getPreviousVersion()).toBe('2026.07.31');
    const rolledBack = await repo.rollback();
    expect(rolledBack).toBe('2026.07.31');
    expect(await repo.getActiveVersion()).toBe('2026.07.31');
  });

  it('refuses to commit a version that was not staged', async () => {
    await repo.initialize(seedPack());
    await expect(repo.commit(v2Pack())).rejects.toBeInstanceOf(StorageError);
  });

  it('discards a staged version so the old version remains intact', async () => {
    await repo.initialize(seedPack());
    await repo.stage(v2Pack());
    await repo.discardStaging();
    expect(await repo.getStagedVersion()).toBeNull();
    expect(await repo.getActiveVersion()).toBe('2026.07.31');
    expect(await repo.getPack('2026.09.01')).toBeNull();
  });

  it('persists reading settings across repository instances', async () => {
    await repo.initialize(seedPack());
    const settings: ReadingSettings = { fontSize: 'large', theme: 'dark' };
    await repo.saveSettings(settings);
    repo.close();

    const reopened = await ContentRepository.open();
    expect(await reopened.loadSettings()).toEqual(settings);
    reopened.close();
  });

  it('returns default settings when none have been saved', async () => {
    await repo.initialize(seedPack());
    expect(await repo.loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('cleans up an interrupted staging on initialize (simulating restart)', async () => {
    await repo.initialize(seedPack());
    await repo.stage(v2Pack());
    repo.close();

    const reopened = await ContentRepository.open();
    await reopened.initialize(seedPack());
    expect(await reopened.getActiveVersion()).toBe('2026.07.31');
    expect(await reopened.getStagedVersion()).toBeNull();
    expect(await reopened.getPack('2026.09.01')).toBeNull();
    reopened.close();
  });
});

afterEach(async () => {
  repo.close();
  await deleteDatabase();
});
