/** One in-flight render plus one replaceable pending snapshot.
 * Cancelling invalidates delivery and drops pending work, not native compilation.
 * Reuse the scheduler across effect cleanups so rapid edits cannot start parallel IPCs.
 */
export function createLatestPreview<Input, Output>(render: (input: Input) => Promise<Output>) {
  type Request = { input: Input; revision: number; success: (output: Output) => void; failure: (error: unknown) => void };
  let revision = 0;
  let running = false;
  let pending: Request | undefined;

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (pending) {
        const request = pending;
        pending = undefined;
        try {
          const output = await render(request.input);
          if (request.revision === revision) request.success(output);
        } catch (error) {
          if (request.revision === revision) request.failure(error);
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    request(input: Input, success: (output: Output) => void, failure: (error: unknown) => void) {
      pending = { input, success, failure, revision: ++revision };
      void drain();
    },
    cancel() {
      ++revision;
      pending = undefined;
    },
  };
}
