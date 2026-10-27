import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
const files = {};
async function walk(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const key = prefix + entry.name;
    if (entry.isDirectory()) await walk(`${dir}/${entry.name}`, `${key}/`);
    else files[key] = new Uint8Array(await readFile(`${dir}/${entry.name}`));
  }
}
await walk('dist');
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/lynk-0.1.0.zip', zipSync(files));
console.log('Packaged artifacts/lynk-0.1.0.zip');
