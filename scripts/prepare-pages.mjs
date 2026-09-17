import { copyFile, mkdir, rm, lstat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// Explicit allowlist: local evidence and working documents cannot enter the artifact.
const files = [
  'index.html', 'assets/styles.css', 'assets/favicon.svg',
  'js/app.js', 'js/calculation.js', 'js/format.js',
  'data/building.json', 'data/reserve-defaults.json', 'data/reserve-observations.json', 'data/legal.json'
];
for (const file of files) {
  const info = await lstat(`site/${file}`);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Not a regular deployable file: ${file}`);
}
await rm('dist', {recursive:true, force:true});
for (const file of files) {
  await mkdir(dirname(`dist/${file}`), {recursive:true});
  await copyFile(`site/${file}`, `dist/${file}`);
}
await writeFile('dist/.nojekyll', '');
console.log(`GitHub Pages artifact: dist/ (${files.length} public files + .nojekyll)`);
