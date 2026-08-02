import { PackageStore } from "../storage/packageStore";
import { SettingsStore } from "../storage/settingsStore";
import { Repository } from "./repository";

/** 浏览器环境的真实依赖：fetch 下载 + 原生 IndexedDB。 */
export async function createAppRepository(): Promise<Repository> {
  const store = await PackageStore.open();
  const settingsStore = await SettingsStore.open();
  const fetchText = async (url: string): Promise<string> => {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`下载失败（HTTP ${response.status}）`);
    }
    return response.text();
  };
  const repository = new Repository({ store, settingsStore, fetchText });
  await repository.init();
  return repository;
}
