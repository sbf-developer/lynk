import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
const files = {};
async function walk(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    // Chrome writes compiled rule caches into unpacked extensions; never distribute them.
    if (prefix === '' && entry.name === '_metadata') continue;
    const key = prefix + entry.name;
    if (entry.isDirectory()) await walk(`${dir}/${entry.name}`, `${key}/`);
    else files[key] = new Uint8Array(await readFile(`${dir}/${entry.name}`));
  }
}
await walk('dist');
await mkdir('artifacts', { recursive: true });
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile(`artifacts/lynk-${version}.zip`, zipSync(files));
console.log(`Packaged artifacts/lynk-${version}.zip`);
