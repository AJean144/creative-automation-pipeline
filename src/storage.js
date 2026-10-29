import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Local-folder storage. shortcut: local disk only; swap for an S3/Azure Blob class with the same save() when outputs must be shared.
export class LocalStorage {
  constructor(root) {
    this.root = path.resolve(root);
  }

  async save(relPath, data) {
    const full = path.join(this.root, relPath);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
    return full;
  }
}
