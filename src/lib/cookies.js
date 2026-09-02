export function mergeCookies(current = "", setCookieHeaders = []) {
  const jar = new Map();
  for (const text of [current, ...setCookieHeaders].filter(Boolean)) {
    for (const pair of text.split(/;\s*/)) {
      const index = pair.indexOf("=");
      if (index <= 0) continue;
      jar.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ") || undefined;
}
