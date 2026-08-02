import { useEffect, useRef, useState } from 'react';
import type { UpdateStatus } from '../types';
import { IconButton } from './IconButton';
import { HomeIcon, RefreshIcon, SearchIcon, SettingsIcon } from './icons';
import { navigate, routeToHash } from '../router/routes';

interface HeaderProps {
  version: string;
  updateStatus: UpdateStatus;
  onCheckUpdate: () => void;
}

export function Header({ version, updateStatus, onCheckUpdate }: HeaderProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen && inputRef.current !== null) {
      inputRef.current.focus();
    }
  }, [searchOpen]);

  const submitSearch = () => {
    const trimmed = query.trim();
    if (trimmed.length === 0) return;
    setSearchOpen(false);
    navigate({ name: 'search', query: trimmed });
  };

  const isUpdating =
    updateStatus.phase !== 'idle' &&
    updateStatus.phase !== 'success' &&
    updateStatus.phase !== 'failed';

  const statusLabel =
    updateStatus.phase === 'idle'
      ? `当前版本 ${version}`
      : updateStatus.message;
  const statusTone =
    updateStatus.phase === 'failed'
      ? 'status-error'
      : updateStatus.phase === 'success'
        ? 'status-success'
        : isUpdating
          ? 'status-pending'
          : 'status-idle';

  return (
    <header className="app-header" role="banner">
      <div className="header-inner">
        <a
          href={routeToHash({ name: 'home' })}
          className="home-link"
          aria-label="返回首页"
        >
          <HomeIcon />
          <span className="brand">无障碍权益指南</span>
        </a>

        <div className="header-actions">
          {searchOpen ? (
            <form
              className="search-form"
              role="search"
              onSubmit={(event) => {
                event.preventDefault();
                submitSearch();
              }}
            >
              <label htmlFor="header-search-input" className="sr-only">
                搜索关键词
              </label>
              <input
                id="header-search-input"
                ref={inputRef}
                type="search"
                value={query}
                placeholder="输入关键词搜索"
                onChange={(event) => setQuery(event.target.value)}
                onBlur={() => {
                  if (query.length === 0) setSearchOpen(false);
                }}
              />
              <button type="submit" className="primary-button">
                搜索
              </button>
            </form>
          ) : (
            <IconButton
              label="打开搜索"
              onClick={() => setSearchOpen(true)}
              className="icon-button"
            >
              <SearchIcon />
            </IconButton>
          )}

          <IconButton
            label="阅读设置"
            onClick={() => navigate({ name: 'settings' })}
            className="icon-button"
          >
            <SettingsIcon />
          </IconButton>

          <IconButton
            label="检查更新"
            onClick={onCheckUpdate}
            disabled={isUpdating}
            className="icon-button"
          >
            <RefreshIcon className={isUpdating ? 'spin' : undefined} />
          </IconButton>
        </div>
      </div>

      <div className="update-status" data-tone={statusTone} role="status" data-testid="update-status">
        <span className="status-dot" aria-hidden="true" />
        <span>{statusLabel}</span>
      </div>
    </header>
  );
}
