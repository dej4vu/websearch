import robotsParser from "robots-parser";
import { request } from "./http.js";
import { WebFetchError } from "../errors.js";

export function robotsUrlFor(targetUrl) {
  const url = new URL(targetUrl);
  return `${url.protocol}//${url.host}/robots.txt`;
}

export async function checkMayAutonomouslyFetchUrl(targetUrl, {
  userAgent,
  proxyUrl,
  timeoutMs,
  dispatcher,
} = {}) {
  const robotUrl = robotsUrlFor(targetUrl);
  let response;
  try {
    response = await request(robotUrl, {
      userAgent,
      proxyUrl,
      timeoutMs,
      dispatcher,
    });
  } catch (error) {
    throw new WebFetchError(
      `Failed to fetch robots.txt ${robotUrl} due to a connection issue`,
      { cause: error },
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new WebFetchError(
      `When fetching robots.txt (${robotUrl}), received status ${response.status}, ` +
      "so autonomous fetching is not allowed.",
    );
  }

  // Unlike 401/403, unavailable robots files are conventionally permissive.
  if (response.status >= 400 && response.status < 500) {
    return;
  }

  const body = await response.text();
  const robot = robotsParser(robotUrl, body);
  if (robot.isAllowed(targetUrl, userAgent) !== true) {
    throw new WebFetchError(
      `The site's robots.txt (${robotUrl}) does not allow autonomous fetching of ${targetUrl} ` +
      `for user agent ${userAgent}.`,
    );
  }
}
