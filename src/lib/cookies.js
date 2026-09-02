export function mergeCookies(current = "", setCookieHeaders = []) {
  const jar = new Map();
  for (const text of [current].filter(Boolean)) {
    for (const pair of text.split(/;\s*/)) {
      const index = pair.indexOf("=");
      if (index <= 0) continue;
      jar.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }

  // Set-Cookie headers carry attributes; honor cookie deletions so a server
  // removing a cookie (past `expires` or `Max-Age=0`) is not re-sent by us as
  // a live value. Sogou, for example, deletes `black_passportid` this way.
  for (const header of setCookieHeaders) {
    const pairs = header.split(/;\s*/);
    const separator = pairs[0].indexOf("=");
    if (separator <= 0) continue;
    const name = pairs[0].slice(0, separator);
    const value = pairs[0].slice(separator + 1);
    const maxAgeMatch = header.match(/(?:^|;\s*)max-age=(\d+)/i);
    const expiresMatch = header.match(/(?:^|;\s*)expires=([^;]+)/i);
    const isDeleted = (maxAgeMatch && Number(maxAgeMatch[1]) === 0)
      || (expiresMatch && !Number.isNaN(Date.parse(expiresMatch[1]))
        && Date.parse(expiresMatch[1]) < Date.now());
    if (isDeleted) {
      jar.delete(name);
    } else {
      jar.set(name, value);
    }
  }

  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ") || undefined;
}
