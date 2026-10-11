'use strict';
const fs = require('node:fs');
const path = require('node:path');

/** Atomic local snapshot. Requires a persistent volume in production. */
class SnapshotFile {
  constructor(directory) {
    this.file = directory ? path.join(directory, 'rooms.json') : null;
  }
  load() {
    if (!this.file || !fs.existsSync(this.file)) return null;
    return JSON.parse(fs.readFileSync(this.file, 'utf8'));
  }
  save(data) {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.tmp`;
    const fd = fs.openSync(temporary, 'w', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(data));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, this.file);
  }
}
module.exports = { SnapshotFile };
