import { fetch, ProxyAgent } from "undici";
import { WebFetchError } from "../errors.js";

export function createDispatcher(proxyUrl) {
  if (!proxyUrl) {
    return undefined;
  }

  let proxy;
  try {
    proxy = new URL(proxyUrl);
  } catch {
    throw new WebFetchError(`Invalid proxy URL: ${proxyUrl}`);
  }

  if (proxy.protocol !== "http:" && proxy.protocol !== "https:") {
    throw new WebFetchError("Proxy URL must use http: or https:");
  }

  return new ProxyAgent(proxyUrl);
}

export async function request(url, {
  userAgent,
  headers = {},
  proxyUrl,
  timeoutMs,
  dispatcher = createDispatcher(proxyUrl),
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new WebFetchError("Timeout must be greater than 0");
  }

  try {
    return await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent": userAgent,
        ...headers,
      },
      signal: AbortSignal.timeout(timeoutMs),
      dispatcher,
    });
  } catch (error) {
    const reason = error?.cause?.message ?? error?.message ?? String(error);
    throw new WebFetchError(`Failed to fetch ${url}: ${reason}`, { cause: error });
  }
}
