import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import sharp from 'sharp';
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
await mkdir('dist/licenses', { recursive: true });
for (const [from, to] of [
  ['LICENSE', 'Lynk.txt'],
  ['docs/licenses/eth-phishing-detect.txt', 'MetaMask-threat-data.txt'],
  ['node_modules/tldts/LICENSE', 'tldts.txt'],
  ['node_modules/tldts-core/LICENSE', 'tldts-core.txt'],
  ['node_modules/punycode/LICENSE-MIT.txt', 'punycode.txt'],
])
  await cp(from, `dist/licenses/${to}`);
await build({
  entryPoints: [
    'src/background.ts',
    'src/ui/popup.ts',
    'src/ui/settings.ts',
    'src/ui/warning.ts',
    'src/ui/explain.ts',
  ],
  bundle: true,
  outdir: 'dist',
  entryNames: '[name]',
  format: 'esm',
  target: 'chrome120',
  minify: true,
  legalComments: 'eof',
});
await build({
  entryPoints: ['src/content.ts'],
  bundle: true,
  outfile: 'dist/content.js',
  format: 'iife',
  target: 'chrome120',
  minify: true,
});
for (const size of [16, 32, 48, 128])
  await sharp('public/icons/mark.svg').resize(size, size).png().toFile(`dist/icons/${size}.png`);
const feed = JSON.parse(await readFile('public/data/threats.json', 'utf8'));
if (!feed.domains?.length) throw new Error('Missing threat feed. Run npm run feeds:update.');
const rules = [];
for (let i = 0; i < feed.domains.length; i += 500) {
  const domains = feed.domains.slice(i, i + 500);
  rules.push({
    id: rules.length + 1,
    priority: 10,
    action: { type: 'redirect', redirect: { extensionPath: '/warning.html' } },
    condition: { requestDomains: domains, resourceTypes: ['main_frame'] },
  });
  rules.push({
    id: rules.length + 1,
    priority: 10,
    action: { type: 'block' },
    condition: { requestDomains: domains, excludedResourceTypes: ['main_frame'] },
  });
}
await writeFile('dist/data/rules.json', JSON.stringify(rules));
// Fail packaging on accidentally referenced remote scripts or missing local entry points.
for (const file of (await readdir('dist')).filter((f) => f.endsWith('.html'))) {
  const html = await readFile(`dist/${file}`, 'utf8');
  if (/<script[^>]+src=["']https?:/i.test(html)) throw new Error(`Remote code in ${file}`);
}
console.log(
  `Built Lynk: ${feed.domains.length.toLocaleString()} threat domains, ${rules.length} native network rules.`,
);
