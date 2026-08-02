import { useSyncExternalStore } from "react";

// 基于 location.hash 的极简路由：断网/任意静态服务器下深链接都可用。
export type Route =
  | { name: "topics" }
  | { name: "topic"; topicId: string }
  | { name: "article"; articleId: string }
  | { name: "search"; query: string }
  | { name: "legal" }
  | { name: "settings" }
  | { name: "notfound"; raw: string };

export function parseRoute(hash: string): Route {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const questionIndex = raw.indexOf("?");
  const path = questionIndex >= 0 ? raw.slice(0, questionIndex) : raw;
  const queryString =
    questionIndex >= 0 ? raw.slice(questionIndex + 1) : raw.slice(raw.length);
  const segments = path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment));
  const first = segments[0];
  if (first === undefined) {
    return { name: "topics" };
  }
  const second = segments[1];
  if (first === "topic" && segments.length === 2 && second !== undefined) {
    return { name: "topic", topicId: second };
  }
  if (first === "article" && segments.length === 2 && second !== undefined) {
    return { name: "article", articleId: second };
  }
  if (first === "search" && segments.length === 1) {
    const params = new URLSearchParams(queryString);
    return { name: "search", query: params.get("q") ?? "" };
  }
  if (first === "legal" && segments.length === 1) {
    return { name: "legal" };
  }
  if (first === "settings" && segments.length === 1) {
    return { name: "settings" };
  }
  return { name: "notfound", raw };
}

export function topicHash(topicId: string): string {
  return `#/topic/${encodeURIComponent(topicId)}`;
}

export function articleHash(articleId: string): string {
  return `#/article/${encodeURIComponent(articleId)}`;
}

export function searchHash(query: string): string {
  return `#/search?q=${encodeURIComponent(query)}`;
}

let cachedHash: string | null = null;
let cachedRoute: Route = { name: "topics" };

function readRoute(): Route {
  const hash = window.location.hash;
  if (hash !== cachedHash) {
    cachedHash = hash;
    cachedRoute = parseRoute(hash);
  }
  return cachedRoute;
}

function subscribeHash(callback: () => void): () => void {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribeHash, readRoute, readRoute);
}

export function navigateTo(hash: string): void {
  window.location.hash = hash;
}

/** 重定向用：替换当前历史记录，避免撤下条目地址残留在后退栈里。 */
export function replaceWith(hash: string): void {
  window.history.replaceState(null, "", hash);
  window.dispatchEvent(new Event("hashchange"));
}
