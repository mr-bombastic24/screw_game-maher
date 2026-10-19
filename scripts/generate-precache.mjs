import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('public');
const includedDirectories = ['assets/cards', 'sounds'];
const files = [];

async function walk(relativeDirectory) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  let entries;
  try { entries = await readdir(absoluteDirectory, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) await walk(relativePath);
    else files.push(`./${relativePath}`);
  }
}

for (const directory of includedDirectories) await walk(directory);
for (const file of ['favicon.svg', 'manifest.webmanifest', 'app-icon-180.png', 'app-icon-192.png', 'app-icon-512.png']) files.push(`./${file}`);
await writeFile(path.join(root, 'precache-assets.json'), `${JSON.stringify({ files }, null, 2)}\n`);
console.log(`Prepared ${files.length} offline game assets.`);
