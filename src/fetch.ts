export interface FetchResult {
  html: string;
  url: string;
  status: number;
  contentType: string;
}

export async function fetchUrl(url: string): Promise<FetchResult> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'mcp-safe-fetch/0.2',
      'Accept': 'text/html,application/xhtml+xml,*/*',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const html = await response.text();
  const contentType = response.headers.get('content-type') || '';

  return {
    html,
    url: response.url,
    status: response.status,
    contentType,
  };
}
