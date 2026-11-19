import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const workspaceDir = path.resolve(process.env.WORKSPACE_DIR || path.join(dataDir, 'workspace'));
const wipeAll = process.argv.includes('--all');

const targets = [
  path.join(workspaceDir, 'tanyadata.db'),
  `${path.join(workspaceDir, 'tanyadata.db')}-wal`,
  `${path.join(workspaceDir, 'tanyadata.db')}-shm`,
];

let removed = 0;
for (const file of targets) {
  if (fs.existsSync(file)) {
    fs.rmSync(file, { force: true });
    removed += 1;
  }
}

const uploads = path.join(workspaceDir, 'uploads');
if (fs.existsSync(uploads)) {
  for (const entry of fs.readdirSync(uploads)) {
    fs.rmSync(path.join(uploads, entry), { recursive: true, force: true });
    removed += 1;
  }
}

if (wipeAll) {
  const generated = path.join(dataDir, 'generated');
  if (fs.existsSync(generated)) {
    fs.rmSync(generated, { recursive: true, force: true });
    removed += 1;
  }
}

console.log(`OK reset removed=${removed} workspace=${path.relative(root, workspaceDir)}${wipeAll ? ' (--all)' : ''}`);
console.log('NEXT npm run db:init');
