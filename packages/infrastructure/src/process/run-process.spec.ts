import { ProcessSpawnError, runProcess, TailBuffer, lastLines } from './run-process';

const node = process.execPath;

describe('TailBuffer', () => {
  it('keeps only the last bytes across chunks', () => {
    const tail = new TailBuffer(5);
    tail.push(Buffer.from('abc'));
    tail.push(Buffer.from('defg'));
    expect(tail.toString()).toBe('cdefg');
  });

  it('truncates a single oversized chunk', () => {
    const tail = new TailBuffer(4);
    tail.push(Buffer.from('0123456789'));
    expect(tail.toString()).toBe('6789');
  });
});

describe('lastLines', () => {
  it('returns the last non-empty lines joined', () => {
    expect(lastLines('a\n\nb\nc\nd\n', 2)).toBe('c | d');
  });
});

describe('runProcess', () => {
  it('reports the exit code and a stderr tail bounded by stderrTailBytes', async () => {
    const result = await runProcess({
      command: node,
      args: ['-e', 'process.stderr.write("x".repeat(100000) + "END"); process.exitCode = 3'],
      signal: new AbortController().signal,
      stderrTailBytes: 1024,
    });
    expect(result.exitCode).toBe(3);
    expect(result.aborted).toBe(false);
    expect(result.stderrTail).toHaveLength(1024);
    expect(result.stderrTail.endsWith('END')).toBe(true);
  });

  it('does not use a shell, so metacharacters stay literal arguments', async () => {
    const result = await runProcess({
      command: node,
      args: ['-e', 'process.stderr.write(process.argv[1])', '$(echo pwned); ls'],
      signal: new AbortController().signal,
    });
    expect(result.stderrTail).toBe('$(echo pwned); ls');
  });

  it('kills the child when the signal aborts', async () => {
    const started = Date.now();
    const result = await runProcess({
      command: node,
      args: ['-e', 'setTimeout(() => {}, 60000)'],
      signal: AbortSignal.timeout(200),
    });
    expect(result.aborted).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('escalates to SIGKILL when the child ignores SIGTERM', async () => {
    const result = await runProcess({
      command: node,
      args: [
        '-e',
        'process.on("SIGTERM", () => {}); process.stderr.write("ready"); setInterval(() => {}, 1000)',
      ],
      signal: AbortSignal.timeout(300),
      killGraceMs: 200,
    });
    expect(result.aborted).toBe(true);
    expect(result.exitSignal).toBe('SIGKILL');
  });

  it('does not spawn when the signal is already aborted', async () => {
    const result = await runProcess({
      command: '/definitely/not/here',
      args: [],
      signal: AbortSignal.abort(),
    });
    expect(result.aborted).toBe(true);
  });

  it('rejects with ProcessSpawnError(ENOENT) for a missing binary', async () => {
    await expect(
      runProcess({
        command: '/definitely/not/here',
        args: [],
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ name: 'ProcessSpawnError', errno: 'ENOENT' });
    await expect(
      runProcess({
        command: '/definitely/not/here',
        args: [],
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(ProcessSpawnError);
  });
});
