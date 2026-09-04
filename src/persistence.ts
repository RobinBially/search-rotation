import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const sleeper = new Int32Array(new SharedArrayBuffer(4));

/** Synchronous Lamport bakery lock for local processes. Each contender owns a
 * unique directory for its whole lifetime; stale recovery never unlinks a
 * successor's lock. Missing ticket means choosing=true. Only dead PIDs are
 * recovered: slow live owners are never evicted on a wall-clock timeout.
 * Limitation: after a crash, OS PID reuse can make an abandoned contender look
 * alive. Writes then time out safely until that PID exits or the abandoned
 * directory is removed while all search-rotation processes are stopped. */
export function withFileLock<T>(file: string, action: () => T, timeoutMs = 10_000): T {
  const root = `${file}.lock`;
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const id = `${process.pid}-${randomUUID()}`;
  const own = path.join(root, id);
  fs.mkdirSync(own, { mode: 0o700 });
  const started = Date.now();
  const ticket = (name: string): number | null => {
    const dir = path.join(root, name);
    const pid = Number(name.split('-')[0]);
    if (!Number.isSafeInteger(pid) || pid <= 0) return null;
    try { process.kill(pid, 0); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
        fs.rmSync(dir, { recursive: true, force: true });
        return null;
      }
    }
    try { return Number(fs.readFileSync(path.join(dir, 'ticket'), 'utf8')) || 0; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return fs.existsSync(dir) ? 0 : null;
    }
  };
  try {
    let mine = 1;
    for (const name of fs.readdirSync(root)) if (name !== id) mine = Math.max(mine, (ticket(name) ?? 0) + 1);
    atomicWriteFile(path.join(own, 'ticket'), String(mine));
    while (true) {
      let blocked = false;
      for (const name of fs.readdirSync(root)) {
        if (name === id) continue;
        const other = ticket(name);
        if (other !== null && (other === 0 || other < mine || (other === mine && name < id))) { blocked = true; break; }
      }
      if (!blocked) return action();
      if (Date.now() - started >= timeoutMs) throw new Error(`Persistence lock timeout: ${path.basename(file)}`);
      Atomics.wait(sleeper, 0, 0, 5);
    }
  } finally { fs.rmSync(own, { recursive: true, force: true }); }
}

/** Unique temp names plus rename keep concurrent readers on complete snapshots. */
export function atomicWriteFile(file: string, content: string): void {
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, content, { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, file);
  } finally { fs.rmSync(tmp, { force: true }); }
}
