import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AppShell } from '../src/ui/AppShell';
import type { Repository } from '../src/services/repository';
import { V1, V2, createRig, defaultChannel, offlineFetcher } from './helpers';

async function renderApp(repository: Repository, hash = ''): Promise<void> {
  window.history.replaceState(null, '', hash === '' ? '/' : `/${hash}`);
  render(<AppShell repository={repository} />);
  await screen.findByRole('heading', { level: 1 });
}

describe('首次离线启动（UI）', () => {
  it('无网络时首屏渲染主题列表，焦点落在主标题，版本可见', async () => {
    const { repository } = await createRig({ fetchText: offlineFetcher() });
    await renderApp(repository);
    expect(screen.getByRole('heading', { name: '主题浏览' })).toHaveFocus();
    expect(screen.getByRole('link', { name: '法律援助' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '公证费用减免' })).toBeInTheDocument();
    expect(screen.getByTestId('version-badge')).toHaveTextContent(`当前版本 ${V1}`);
  });
});

describe('完整键盘路径', () => {
  it('Tab/Enter 走通：跳转链接 → 主题 → 条目 → 反向回到页头导航', async () => {
    const user = userEvent.setup();
    const { repository } = await createRig();
    await renderApp(repository);

    const topicsHeading = screen.getByRole('heading', { name: '主题浏览' });
    expect(topicsHeading).toHaveFocus();
    // 回到文档起点，从页头开始走 Tab 路径
    topicsHeading.blur();

    await user.tab();
    const skipLink = screen.getByRole('link', { name: '跳到主要内容' });
    expect(skipLink).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(document.getElementById('main-content')).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('link', { name: '法律援助' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { name: '法律援助' })).toHaveFocus();

    await user.tab();
    expect(
      screen.getByRole('link', { name: '无固定生活来源免予经济困难核查' })
    ).toHaveFocus();
    await user.keyboard('{Enter}');
    const articleHeading = await screen.findByRole('heading', {
      name: '无固定生活来源免予经济困难核查'
    });
    expect(articleHeading).toHaveFocus();

    // 反向 Shift+Tab：条目 → 检查更新 → 设置 → 法律依据 → 检索 → 主题 → 跳转链接
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: '检查更新' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('link', { name: '设置' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('link', { name: '法律依据' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('link', { name: '检索' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('link', { name: '主题' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(skipLink).toHaveFocus();
  });

  it('键盘完成检索并进入结果条目', async () => {
    const user = userEvent.setup();
    const { repository } = await createRig();
    await renderApp(repository, '#/search');

    expect(await screen.findByRole('heading', { name: '全文检索' })).toHaveFocus();
    await user.tab();
    const input = screen.getByRole('searchbox', { name: '搜索关键词' });
    expect(input).toHaveFocus();
    await user.keyboard('公证');

    const resultLink = await screen.findByRole('link', { name: '公证费用减免' });
    await waitFor(() =>
      expect(screen.getByTestId('live-polite')).toHaveTextContent('找到 1 条结果')
    );

    await user.tab();
    expect(screen.getByRole('button', { name: '清除搜索' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: '搜索' })).toHaveFocus();
    await user.tab();
    expect(resultLink).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { name: '公证费用减免' })).toHaveFocus();
  });
});

describe('屏幕阅读器公告', () => {
  it('更新成功：polite 公告新版本号，焦点恢复到修订后的条目标题', async () => {
    const user = userEvent.setup();
    const { repository } = await createRig({ fetchText: defaultChannel().fetchText });
    await renderApp(repository, '#/article/ART-AID-1');
    await screen.findByRole('heading', { name: '无固定生活来源免予经济困难核查' });

    await user.click(screen.getByRole('button', { name: '检查更新' }));
    await waitFor(() =>
      expect(screen.getByTestId('live-polite')).toHaveTextContent(`已更新到内容版本 ${V2}`)
    );
    const revisedHeading = await screen.findByRole('heading', {
      name: '无固定生活来源的法援核查规则'
    });
    expect(revisedHeading).toHaveFocus();
    expect(screen.getByTestId('version-badge')).toHaveTextContent(`当前版本 ${V2}`);
  });

  it('更新失败（断网）：assertive 公告沿用旧版本，可见状态文本不依赖颜色', async () => {
    const user = userEvent.setup();
    const { repository } = await createRig({ fetchText: offlineFetcher() });
    await renderApp(repository);

    await user.click(screen.getByRole('button', { name: '检查更新' }));
    await waitFor(() =>
      expect(screen.getByTestId('live-assertive')).toHaveTextContent(
        `更新失败，继续使用旧版本 ${V1}`
      )
    );
    const status = screen.getByTestId('update-status');
    expect(status).toHaveTextContent('更新失败');
    expect(status).toHaveTextContent(`仍使用旧版本 ${V1}`);
    expect(screen.getByTestId('version-badge')).toHaveTextContent(`当前版本 ${V1}`);
  });

  it('撤下条目深链接：assertive 公告后跳转到替代条目，焦点落在新标题', async () => {
    const { repository } = await createRig({ fetchText: defaultChannel().fetchText });
    await repository.checkForUpdates();
    await renderApp(repository, '#/article/ART-AID-2');

    const heading = await screen.findByRole('heading', { name: '行动不便时的上门服务' });
    await waitFor(() =>
      expect(screen.getByTestId('live-assertive')).toHaveTextContent(
        '原条目已撤下，已为你跳转到替代条目'
      )
    );
    expect(heading).toHaveFocus();
    expect(window.location.hash).toBe('#/article/ART-SERVICE-3');
  });

  it('检索结果数量与“未找到匹配结果”均有 polite 公告', async () => {
    const user = userEvent.setup();
    const { repository } = await createRig();
    await renderApp(repository, '#/search');

    const input = await screen.findByRole('searchbox', { name: '搜索关键词' });
    await user.type(input, '公证');
    await waitFor(() =>
      expect(screen.getByTestId('live-polite')).toHaveTextContent('找到 1 条结果')
    );
    expect(screen.getByTestId('result-count')).toHaveTextContent('共 1 条结果');

    await user.clear(input);
    await user.type(input, 'zzzzq');
    await waitFor(() =>
      expect(screen.getByTestId('live-polite')).toHaveTextContent('未找到匹配结果')
    );
    expect(screen.getByTestId('result-count')).toHaveTextContent('共 0 条结果');
  });

  it('阅读设置保存有 polite 公告', async () => {
    const user = userEvent.setup();
    const { repository } = await createRig();
    await renderApp(repository, '#/settings');

    await user.click(await screen.findByRole('radio', { name: '大' }));
    await waitFor(() =>
      expect(screen.getByTestId('live-polite')).toHaveTextContent('阅读设置已保存')
    );
  });
});

describe('图标按钮与状态表达', () => {
  it('清除搜索图标按钮有可访问名称，清除后焦点回到输入框', async () => {
    const user = userEvent.setup();
    const { repository } = await createRig();
    await renderApp(repository, '#/search');

    const input = await screen.findByRole('searchbox', { name: '搜索关键词' });
    await user.type(input, '公证');
    const clearButton = await screen.findByRole('button', { name: '清除搜索' });
    await user.click(clearButton);
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
  });
});

describe('阅读设置跨版本保持', () => {
  it('字号/主题设置应用到根元素，更新到 v2 后保持不变', async () => {
    const user = userEvent.setup();
    const { repository } = await createRig({ fetchText: defaultChannel().fetchText });
    await renderApp(repository, '#/settings');

    await user.click(await screen.findByRole('radio', { name: '大' }));
    await user.click(screen.getByRole('radio', { name: '高对比' }));
    expect(document.documentElement.dataset['fontScale']).toBe('large');
    expect(document.documentElement.dataset['theme']).toBe('contrast');

    await user.click(screen.getByRole('button', { name: '检查更新' }));
    await waitFor(() =>
      expect(screen.getByTestId('version-badge')).toHaveTextContent(`当前版本 ${V2}`)
    );
    expect(document.documentElement.dataset['fontScale']).toBe('large');
    expect(document.documentElement.dataset['theme']).toBe('contrast');
  });
});

describe('深链接与法律依据', () => {
  it('检索深链接（带查询参数）直接出结果并公告', async () => {
    const { repository } = await createRig();
    await renderApp(repository, '#/search?q=公证');
    expect(await screen.findByRole('link', { name: '公证费用减免' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('live-polite')).toHaveTextContent('找到 1 条结果')
    );
  });

  it('条目页展示法律依据区块，可进入法律依据索引页', async () => {
    const user = userEvent.setup();
    const { repository } = await createRig();
    await renderApp(repository, '#/article/ART-NOTARY-1');

    await screen.findByRole('heading', { level: 1, name: '公证费用减免' });
    const legalSection = screen.getByRole('heading', { level: 2, name: '法律依据' });
    expect(legalSection.nextElementSibling).toHaveTextContent('公证服务规范');

    await user.click(screen.getByRole('link', { name: '查看全部法律依据' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: '法律依据' })
    ).toHaveFocus();
    expect(screen.getByRole('heading', { level: 2, name: '法律援助法' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: '公证服务规范' })
    ).toBeInTheDocument();
  });
});

describe('回滚（UI）', () => {
  it('更新后可从设置页回滚到完整旧版本，公告并恢复焦点', async () => {
    const user = userEvent.setup();
    const { repository } = await createRig({ fetchText: defaultChannel().fetchText });
    await renderApp(repository, '#/settings');

    const rollbackButton = await screen.findByRole('button', { name: '回滚到上一版本' });
    expect(rollbackButton).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '检查更新' }));
    await waitFor(() =>
      expect(screen.getByTestId('version-badge')).toHaveTextContent(`当前版本 ${V2}`)
    );
    expect(screen.getByRole('button', { name: '回滚到上一版本' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: '回滚到上一版本' }));
    await waitFor(() =>
      expect(screen.getByTestId('live-polite')).toHaveTextContent(`已回滚到内容版本 ${V1}`)
    );
    expect(screen.getByTestId('version-badge')).toHaveTextContent(`当前版本 ${V1}`);
    expect(screen.getByRole('heading', { name: '阅读设置' })).toHaveFocus();
  });
});
