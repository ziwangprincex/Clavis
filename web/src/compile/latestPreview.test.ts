import { describe, expect, it, vi } from 'vitest';
import { createLatestPreview } from './latestPreview';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('latest-only preview queue', () => {
  it('serializes work and replaces intermediate pending snapshots', async () => {
    const first = deferred<string>();
    const render = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue('new SVG');
    const delivered = vi.fn();
    const queue = createLatestPreview<string, string>(render);
    queue.request('A', delivered, vi.fn());
    queue.request('B', delivered, vi.fn());
    queue.request('C', delivered, vi.fn());
    expect(render.mock.calls).toEqual([['A']]);
    first.resolve('old SVG');
    await flush();
    expect(render.mock.calls).toEqual([['A'], ['C']]);
    expect(delivered.mock.calls).toEqual([['new SVG']]);
  });

  it('hiding drops queued work and suppresses in-flight results', async () => {
    const first = deferred<string>();
    const render = vi.fn().mockReturnValue(first.promise);
    const delivered = vi.fn();
    const queue = createLatestPreview<string, string>(render);
    queue.request('A', delivered, delivered);
    queue.request('B', delivered, delivered);
    queue.cancel();
    first.resolve('old');
    await flush();
    expect(render).toHaveBeenCalledTimes(1);
    expect(delivered).not.toHaveBeenCalled();
  });

  it('reopening waits for the old worker, then renders only the newest buffer', async () => {
    const first = deferred<string>();
    const render = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue('reopened');
    const delivered = vi.fn();
    const queue = createLatestPreview<string, string>(render);
    queue.request('A', delivered, vi.fn());
    queue.cancel();
    queue.request('C', delivered, vi.fn());
    expect(render).toHaveBeenCalledTimes(1);
    first.reject(new Error('stale failure'));
    await flush();
    expect(delivered.mock.calls).toEqual([['reopened']]);
  });

  it('recovers after a current rejection or synchronous exception', async () => {
    const failure = vi.fn();
    const success = vi.fn();
    const render = vi.fn().mockRejectedValueOnce('failed').mockImplementationOnce(() => { throw new Error('sync'); }).mockResolvedValue('ok');
    const queue = createLatestPreview<string, string>(render);
    queue.request('A', success, failure);
    await flush();
    queue.request('B', success, failure);
    await flush();
    queue.request('C', success, failure);
    await flush();
    expect(failure).toHaveBeenCalledTimes(2);
    expect(success).toHaveBeenCalledWith('ok');
  });
});
