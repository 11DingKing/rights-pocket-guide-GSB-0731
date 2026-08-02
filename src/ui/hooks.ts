import { useEffect, useRef, useSyncExternalStore } from "react";
import type { Repository, RepositorySnapshot } from "../services/repository";

/** 订阅仓储快照（useSyncExternalStore，无需外部状态库）。 */
export function useRepositorySnapshot(
  repository: Repository,
): RepositorySnapshot {
  return useSyncExternalStore(repository.subscribe, repository.getSnapshot);
}

/**
 * 视图标题聚焦：路由切换或依赖值变化时，把焦点移到 h1（tabIndex=-1），
 * 保证键盘与屏幕阅读器用户落点确定。
 */
export function useHeadingFocus(dependency: unknown): {
  headingRef: (node: HTMLHeadingElement | null) => void;
} {
  const nodeRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    nodeRef.current?.focus();
  }, [dependency]);
  return {
    headingRef: (node) => {
      nodeRef.current = node;
    },
  };
}
