/**
 * Network abstraction. The service layer depends on this interface rather than
 * `fetch` directly so tests can inject interruptions (download aborted before
 * checksum), corruption (checksum mismatch), and offline behaviour without a
 * real network. In the browser, `HttpFetcher` reads static assets under the
 * app's base URL; the same files that were built into `public/materials`.
 */
export interface TextFetcher {
  fetchText(url: string): Promise<string>;
}

export class FetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FetchError';
  }
}

export class HttpFetcher implements TextFetcher {
  constructor(private readonly baseUrl: string) {}

  async fetchText(url: string): Promise<string> {
    const full = new URL(url, this.baseUrl).toString();
    const response = await fetch(full);
    if (!response.ok) {
      throw new FetchError(`HTTP ${response.status} for ${url}`);
    }
    return response.text();
  }
}

/** A fetcher backed by an in-memory map — used for the bundled offline seed. */
export class BundledFetcher implements TextFetcher {
  constructor(
    private readonly manifestText: string,
    private readonly packTexts: Readonly<Record<string, string>>,
  ) {}

  async fetchText(url: string): Promise<string> {
    if (url.endsWith('manifest.json')) {
      return this.manifestText;
    }
    const key = url.split('/').pop() ?? url;
    const text = this.packTexts[key];
    if (text === undefined) {
      throw new FetchError(`Bundled asset not found: ${url}`);
    }
    return text;
  }
}
