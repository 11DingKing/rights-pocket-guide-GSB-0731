import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { buildSearchIndex } from '../src/core/search';
import { AppShell } from '../src/ui/AppShell';
import type { Repository } from '../src/services/repository';
import { SETTINGS_KEY_CURRENT, STORE_SETTINGS, openGuideDatabase } from '../src/storage/database';
import { requestToPromise, runInTransaction } from '../src/storage/idb';
import {
  corruptCyclicPack,
  createRig,
  defaultChannel,
  offlineFetcher
} from './helpers';

async function renderApp(repository: Repository, hash = ''): Promise<void> {
  window.history.replaceState(null, '', hash === '' ? '/' : `/${hash}`);
  render(<AppShell repository={repository} />);
  await screen.findByRole('heading', { level: 1 });
}

describe('深链接迁移（更新时正在阅读被撤下的条目）', () => {
  it('焦点保留后跳到替代文章，并宣布“内容已更新”', async () => {
    const user = userEvent.setup();
    const { repository } = await createRig({ fetchText: defaultChannel().fetchText });
    await renderApp(repository, '#/article/ART-AID-2');
    // v1 下正常阅读旧条目，焦点在标题
    expect(
      await screen.findByRole('heading', { name: '行动不便时的服务方式' })
    ).toHaveFocus();

    await user.click(screen.getByRole('button', { name: '检查更新' }));

    // 撤下 → 跳到替代条目；焦点保留并落在替代条目标题
    const heading = await screen.findByRole('heading', { name: '行动不便时的上门服务' });
    await waitFor(() =>
      expect(screen.getByTestId('live-assertive')).toHaveTextContent('内容已更新')
    );
    expect(screen.getByTestId('live-assertive')).toHaveTextContent(
      '原条目已撤下，已为你跳转到替代条目'
    );
    expect(heading).toHaveFocus();
    expect(window.location.hash).toBe('#/article/ART-SERVICE-3');
  });
});

describe('替代链成环的可访问降级状态', () => {
  it('损坏的替代链渲染稳定降级页：焦点落标题、assertive 公告、其余内容可用', async () => {
    const user = userEvent.setup();
    const { repository, store } = await createRig({ fetchText: offlineFetcher() });
    const corrupt = corruptCyclicPack();
    await store.installInitial({
      version: corrupt.packageVersion,
      status: 'active',
      pack: corrupt,
      index: buildSearchIndex(corrupt),
      storedAt: 't'
    });
    // 重新初始化，让仓储加载损坏后的激活包
    await repository.init();

    await renderApp(repository, '#/article/ART-AID-2');
    const heading = await screen.findByRole('heading', { name: '条目暂时不可用' });
    expect(heading).toHaveFocus();
    await waitFor(() =>
      expect(screen.getByTestId('live-assertive')).toHaveTextContent(
        '该条目的替代关系存在异常'
      )
    );
    // 降级页提供稳定出路，且其余内容正常
    await user.click(screen.getByRole('link', { name: '返回主题浏览' }));
    expect(await screen.findByRole('heading', { name: '主题浏览' })).toHaveFocus();
    expect(screen.getByRole('link', { name: '法律援助' })).toBeInTheDocument();
  });
});

describe('无效偏好的可访问降级状态', () => {
  it('设置记录损坏 → 回退默认设置，界面稳定可用', async () => {
    const { repository } = await createRig({ fetchText: offlineFetcher() });
    // 在渲染前把 settings 仓写坏
    const db = await openGuideDatabase();
    await runInTransaction(db, [STORE_SETTINGS], 'readwrite', async (tx) => {
      await requestToPromise(
        tx.objectStore(STORE_SETTINGS).put({ schemaVersion: 9, values: 'junk' }, SETTINGS_KEY_CURRENT)
      );
    });
    db.close();
    await repository.init();

    await renderApp(repository, '#/settings');
    const fontGroup = await screen.findByRole('group', { name: '字号' });
    expect(within(fontGroup).getByRole('radio', { name: '标准' })).toBeChecked();
    expect(document.documentElement.dataset['fontScale']).toBe('standard');
    expect(document.documentElement.dataset['theme']).toBe('system');
    // schema 1：不提供字间距控件
    expect(screen.queryByTestId('letter-spacing-group')).not.toBeInTheDocument();
  });
});

describe('配额耗尽写设置的可访问降级状态', () => {
  it('保存失败有 assertive 公告，界面与数据保持最后一次可用设置', async () => {
    const user = userEvent.setup();
    const { repository, settingsStore } = await createRig({ fetchText: offlineFetcher() });
    await renderApp(repository, '#/settings');
    await screen.findByRole('heading', { name: '阅读设置' });

    settingsStore.writeCurrent = async () => {
      throw new DOMException('磁盘已满', 'QuotaExceededError');
    };
    await user.click(screen.getByRole('radio', { name: '大' }));

    await waitFor(() =>
      expect(screen.getByTestId('live-assertive')).toHaveTextContent(
        '设置保存失败：存储空间不足，当前阅读设置保持不变'
      )
    );
    // 界面与根属性保持原设置（未应用的修改不生效）
    expect(document.documentElement.dataset['fontScale']).toBe('standard');
    const fontGroup = screen.getByRole('group', { name: '字号' });
    expect(within(fontGroup).getByRole('radio', { name: '标准' })).toBeChecked();
    expect(repository.getSnapshot().settings.values.fontScale).toBe('standard');
  });
});

describe('设置 schema 随版本升级/回滚的界面表现', () => {
  it('v2 出现字间距控件并生效；回滚后控件消失、设置精确恢复', async () => {
    const user = userEvent.setup();
    const { repository } = await createRig({ fetchText: defaultChannel().fetchText });
    await renderApp(repository, '#/settings');
    expect(screen.queryByTestId('letter-spacing-group')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '检查更新' }));
    await waitFor(() =>
      expect(screen.getByTestId('version-badge')).toHaveTextContent('当前版本 2026.09.01')
    );
    // schema 2：字间距控件出现
    const group = await screen.findByTestId('letter-spacing-group');
    await user.click(screen.getByRole('radio', { name: '加宽' }));
    await waitFor(() => expect(document.documentElement.dataset['letterSpacing']).toBe('wide'));
    expect(group).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '回滚到上一版本' }));
    await waitFor(() =>
      expect(screen.getByTestId('version-badge')).toHaveTextContent('当前版本 2026.07.31')
    );
    // 回滚：控件消失，根属性复位，设置回到 v1 备份
    expect(screen.queryByTestId('letter-spacing-group')).not.toBeInTheDocument();
    expect(document.documentElement.dataset['letterSpacing']).toBe('standard');
    expect(repository.getSnapshot().settings).toEqual({
      schemaVersion: 1,
      values: { fontScale: 'standard', theme: 'system', lineSpacing: 'standard' }
    });
  });
});
