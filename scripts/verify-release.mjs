import { readFileSync } from 'node:fs';
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const tag = process.env.RELEASE_TAG;
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? '') || tag !== `v${version}`) {
  throw new Error(`Release tag ${JSON.stringify(tag)} must match package version v${version}`);
}
console.log(`Release ${tag}: package version matches.`);
