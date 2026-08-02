import { describe, expect, it } from 'vitest';
import { InvalidSignatureError } from '../src/core/errors';
import { verifyPackSignature } from '../src/core/signature';
import { ensureSeeded } from '../src/services/seed';
import { runUpdate } from '../src/services/updateService';
import { PackageStore } from '../src/storage/packageStore';
import {
  V1,
  V2,
  devSigner,
  expectCompleteV1,
  fixtureText,
  generateSigner,
  sha256Of,
  updateChannel
} from './helpers';

describe('签名校验', () => {
  it('开发签名器的签名可通过内置开发公钥验证（应用默认信任锚）', async () => {
    const hex = sha256Of(fixtureText('content-pack-v2.json'));
    await expect(
      verifyPackSignature(hex, devSigner().sign(hex), devSigner().publicKey)
    ).resolves.toBeUndefined();
  });

  it('签名与摘要不匹配 → InvalidSignatureError', async () => {
    const hex = sha256Of(fixtureText('content-pack-v2.json'));
    const forged = devSigner().sign('0'.repeat(64));
    await expect(verifyPackSignature(hex, forged, devSigner().publicKey)).rejects.toThrow(
      InvalidSignatureError
    );
  });

  it('攻击者换钥重签清单 → signature 阶段失败，旧包完整', async () => {
    const store = await PackageStore.open();
    await ensureSeeded(store);
    const attacker = generateSigner();
    // 哈希值是真的，但签名出自攻击者私钥；信任锚（内置公钥）不予通过。
    const channel = updateChannel(
      [
        { version: V1, text: fixtureText('content-pack-v1.json'), kind: 'full' },
        { version: V2, text: fixtureText('content-pack-v2.json'), kind: 'delta', succeeds: V1 }
      ],
      { signWith: attacker.sign }
    );
    const result = await runUpdate({ fetchText: channel.fetchText, store });
    expect(result).toMatchObject({ status: 'failed', stage: 'signature', activeVersion: V1 });
    await expectCompleteV1(store);
  });

  it('签名对象被篡改（签的是别的摘要）→ signature 阶段失败，旧包完整', async () => {
    const store = await PackageStore.open();
    await ensureSeeded(store);
    const channel = updateChannel(
      [{ version: V2, text: fixtureText('content-pack-v2.json'), kind: 'delta', succeeds: V1 }],
      { signWith: () => devSigner().sign('f'.repeat(64)) }
    );
    const result = await runUpdate({ fetchText: channel.fetchText, store });
    expect(result).toMatchObject({ status: 'failed', stage: 'signature', activeVersion: V1 });
    await expectCompleteV1(store);
  });

  it('清单缺少签名字段 → download 阶段解析失败，旧包完整', async () => {
    const store = await PackageStore.open();
    await ensureSeeded(store);
    const manifest = JSON.stringify({
      latest: V2,
      packages: [
        {
          packageVersion: V2,
          url: 'materials/content-pack-v2.json',
          sha256: sha256Of(fixtureText('content-pack-v2.json')),
          kind: 'delta',
          succeeds: V1
        }
      ]
    });
    const result = await runUpdate({
      fetchText: async (url: string) => {
        if (url === 'materials/manifest.json') {
          return manifest;
        }
        throw new Error(`网络不可用：${url}`);
      },
      store
    });
    expect(result).toMatchObject({ status: 'failed', stage: 'download', activeVersion: V1 });
    expect(result.status === 'failed' ? result.message : '').toContain('signature');
    await expectCompleteV1(store);
  });
});
