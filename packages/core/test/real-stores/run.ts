import { strict as assert } from 'node:assert';
import { fork, ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';

type Message = { type: string; approvalId?: string; output?: string; error?: string };

async function main() {
  assert(process.env.REDIS_URL && process.env.POSTGRES_URL, 'Set REDIS_URL and POSTGRES_URL to dedicated disposable test databases');
  const dir = mkdtempSync(join(tmpdir(), 'agentic-recovery-'));
  const children = new Set<ChildProcess>();
  function launch(backend: string, action: string, session: string, ledger: string, id = '') {
    const child = fork(join(__dirname, 'worker.js'), [backend, action, session, ledger, id], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    children.add(child);
    const messages: Message[] = [];
    const waiters: Array<() => void> = [];
    let exited = false;
    child.on('message', (message: Message) => { messages.push(message); waiters.splice(0).forEach((f) => f()); });
    child.on('exit', () => { exited = true; children.delete(child); waiters.splice(0).forEach((f) => f()); });
    child.on('error', () => { exited = true; waiters.splice(0).forEach((f) => f()); });
    return {
      child,
      async next(): Promise<Message> {
        const deadline = Date.now() + 20000;
        while (!messages.length) {
          if (exited) throw new Error(`${backend}/${action} exited before replying`);
          const remaining = deadline - Date.now();
          if (remaining <= 0) throw new Error(`${backend}/${action} timed out`);
          await new Promise<void>((resolve) => {
            const wake = () => { clearTimeout(timer); resolve(); };
            const timer = setTimeout(() => {
              const index = waiters.indexOf(wake);
              if (index >= 0) waiters.splice(index, 1);
              resolve();
            }, remaining);
            waiters.push(wake);
          });
        }
        return messages.shift()!;
      },
    };
  }
  const effects = (path: string) => existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).length : 0;
  async function kill(child: ChildProcess) {
    const exit = once(child, 'exit');
    child.kill('SIGKILL');
    const [, signal] = await exit;
    assert.equal(signal, 'SIGKILL');
  }
  try {
    for (const backend of ['redis', 'postgres']) {
      const session = randomUUID(), ledger = join(dir, `${backend}.log`);
      const initial = launch(backend, 'suspend', session, ledger);
      const suspended = await initial.next();
      assert.equal(suspended.type, 'suspended');
      assert(suspended.approvalId);
      assert.equal(effects(ledger), 0);
      await kill(initial.child);

      const denied = launch(backend, 'wrong-tenant', session, ledger, suspended.approvalId);
      assert.equal((await denied.next()).type, 'ready');
      denied.child.send('go');
      assert.equal((await denied.next()).type, 'refused');
      assert.equal(effects(ledger), 0, 'Cross-tenant approval must not execute a tool');

      const a = launch(backend, 'approve', session, ledger, suspended.approvalId);
      const b = launch(backend, 'approve', session, ledger, suspended.approvalId);
      assert.equal((await a.next()).type, 'ready');
      assert.equal((await b.next()).type, 'ready');
      a.child.send('go'); b.child.send('go');
      const outcomes = await Promise.all([a.next(), b.next()]);
      assert.equal(outcomes.filter((m) => m.type === 'approved').length, 1);
      assert.equal(outcomes.filter((m) => m.type === 'refused' && m.error === 'ApprovalNotFoundError').length, 1);
      assert.equal(outcomes.find((m) => m.type === 'approved')?.output, 'Effect recorded after recovery.');
      assert.equal(effects(ledger), 1, 'Only one process may execute the approved tool');

      const midSession = randomUUID(), midLedger = join(dir, `${backend}-mid.log`);
      const mid = launch(backend, 'mid', midSession, midLedger);
      assert.equal((await mid.next()).type, 'checkpointed');
      assert.equal(effects(midLedger), 1);
      await kill(mid.child);
      const resumed = launch(backend, 'recover', midSession, midLedger);
      assert.equal((await resumed.next()).output, 'Effect recorded after recovery.');
      assert.equal(effects(midLedger), 1, 'A checkpointed tool must not be replayed');
      console.log(`PASS ${backend}: SIGKILL, cross-tenant refusal, concurrent approval, checkpoint recovery`);
    }
  } finally {
    await Promise.all([...children].map(async (child) => {
      const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit;
    }));
    rmSync(dir, { recursive: true, force: true });
  }
}
main().catch((err: unknown) => { console.error(err); process.exitCode = 1; });
