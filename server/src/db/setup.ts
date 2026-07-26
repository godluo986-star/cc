/** CLI: creates (or with --reset, wipes and recreates) the SQLite database. */
import fs from 'node:fs';
import { openDatabase } from './database';
import { config } from '../config';

const reset = process.argv.includes('--reset');
if (reset && fs.existsSync(config.dbPath)) {
  fs.rmSync(config.dbPath);
  for (const suffix of ['-wal', '-shm']) {
    const p = config.dbPath + suffix;
    if (fs.existsSync(p)) fs.rmSync(p);
  }
  console.log(`Removed ${config.dbPath}`);
}
const db = openDatabase();
db.close();
console.log(`Database ready at ${config.dbPath}`);
