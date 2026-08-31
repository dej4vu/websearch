import { readFileSync } from "node:fs";

const tag = process.env.GITHUB_REF_NAME;
const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

if (!tag) {
  console.error("GITHUB_REF_NAME is required.");
  process.exit(1);
}

const match = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)$/.exec(tag);

if (!match) {
  console.error(`Invalid release tag "${tag}"; expected a "v<semver>" tag such as "v0.3.3".`);
  process.exit(1);
}

if (match[1] !== version) {
  console.error(`Release tag "${tag}" does not match package.json version "${version}".`);
  process.exit(1);
}

console.log(`Release tag matches package version ${version}.`);
