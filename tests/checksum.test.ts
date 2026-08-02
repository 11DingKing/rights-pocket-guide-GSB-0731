import { describe, expect, it } from 'vitest';
import { sha256Hex, verifyChecksum, ChecksumError } from '../src/content/checksum';

describe('checksum', () => {
  it('computes a stable sha-256 hex digest', async () => {
    const a = await sha256Hex(new TextEncoder().encode('hello'));
    const b = await sha256Hex(new TextEncoder().encode('hello'));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('resolves when checksum matches', async () => {
    const bytes = new TextEncoder().encode('rights-pocket-guide');
    const expected = await sha256Hex(bytes);
    await expect(verifyChecksum(bytes, expected)).resolves.toBeUndefined();
  });

  it('rejects with ChecksumError on mismatch', async () => {
    const bytes = new TextEncoder().encode('rights-pocket-guide');
    await expect(verifyChecksum(bytes, 'deadbeef')).rejects.toBeInstanceOf(
      ChecksumError,
    );
  });
});
