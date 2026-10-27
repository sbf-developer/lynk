import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base = 'https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/';
const response = await fetch(
  'https://api.github.com/repos/MetaMask/eth-phishing-detect/commits/main',
  { headers: { 'User-Agent': 'lynk-feed-builder' } },
);
if (!response.ok) throw new Error(`Feed revision request failed: ${response.status}`);
const { sha } = await response.json();
const [configResponse, licenseResponse] = await Promise.all([
  fetch(`${base}${sha}/src/config.json`),
  fetch(`${base}${sha}/LICENSE`),
]);
if (!configResponse.ok || !licenseResponse.ok)
  throw new Error('Feed download failed; existing snapshot retained.');
const raw = await configResponse.text();
const config = JSON.parse(raw);
const normalize = (d) => {
  if (typeof d !== 'string' || d.length > 253 || /[\s/:@?#*]/.test(d)) return null;
  try {
    const host = new URL(`https://${d}`).hostname.toLowerCase().replace(/\.$/, '');
    return host.includes('.') && /^[a-z0-9.-]+$/.test(host) ? host : null;
  } catch {
    return null;
  }
};
const domains = [
  ...new Set((config.blacklist ?? config.blocklist ?? []).map(normalize).filter(Boolean)),
].sort();
if (domains.length < 10000 || domains.length > 1000000)
  throw new Error('Unexpected feed size; snapshot retained.');
const allowlist = [
  ...new Set((config.whitelist ?? config.allowlist ?? []).map(normalize).filter(Boolean)),
].sort();
// Feed allowlist is only a fuzzy-match exemption; never override an explicit block.
const metadata = {
  source: 'MetaMask / eth-phishing-detect',
  sourceUrl: 'https://github.com/MetaMask/eth-phishing-detect',
  revision: sha,
  retrievedAt: new Date().toISOString(),
  sha256: createHash('sha256').update(raw).digest('hex'),
  domainCount: domains.length,
};
await mkdir('public/data', { recursive: true });
await mkdir('docs/licenses', { recursive: true });
await writeFile('public/data/threats.json', JSON.stringify({ ...metadata, domains, allowlist }));
await writeFile('public/data/feed-meta.json', JSON.stringify(metadata, null, 2) + '\n');
await writeFile('docs/licenses/eth-phishing-detect.txt', await licenseResponse.text());
console.log(`Pinned ${domains.length} domains at ${sha}. Review changes before publishing.`);
