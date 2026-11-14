/**
 * A web ReadableStream over a file (or a byte range of it) that is safe when the client
 * goes away mid-download.
 *
 * Why not `Readable.toWeb(fs.createReadStream(...))`: Node's adapter keeps calling
 * `controller.enqueue()` for chunks the file stream had already buffered after the web
 * stream is cancelled. When the browser aborts a request (the audio player seeks, the
 * listener leaves the page), Next.js cancels the response body and that late enqueue throws
 * `TypeError: Invalid state: Controller is already closed` (ERR_INVALID_STATE) from inside a
 * stream event handler, so it surfaces as an uncaughtException.
 *
 * This version is pull-based: each chunk is one positioned read on a FileHandle, made only
 * when the consumer asks for more. Nothing runs between pulls, so nothing can write after a
 * cancel. Every enqueue/close/error goes through a guard that turns writes after close into
 * no-ops, and the file handle is closed on cancel, on `signal` abort, at the end, or on error.
 * An aborted `signal` errors the stream so nothing is left waiting on it.
 */
import fs from "node:fs/promises";

export const FILE_STREAM_CHUNK = 64 * 1024;

export type FileStreamOptions = {
  /** First byte to send (inclusive). Default 0. */
  start?: number;
  /** Last byte to send (inclusive). Default: end of file. */
  end?: number;
  /** Abort (e.g. `req.signal`) stops reading and closes the file, as a cancel would. */
  signal?: AbortSignal;
  chunkSize?: number;
};

export function fileStream(file: string, opts: FileStreamOptions = {}): ReadableStream<Uint8Array> {
  const chunkSize = opts.chunkSize ?? FILE_STREAM_CHUNK;
  let pos = opts.start ?? 0;
  const end = opts.end ?? Infinity;
  let handle: Promise<fs.FileHandle> | null = null;
  let finished = false;
  let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;

  const release = () => {
    opts.signal?.removeEventListener("abort", onAbort);
    const h = handle;
    handle = null;
    // FileHandle.close() waits for an in-flight read to settle before closing.
    h?.then((fh) => fh.close()).catch(() => {});
  };
  /** Ends the stream exactly once; later calls (and late reads) are no-ops. */
  const finish = (how: "close" | "cancel" | Error) => {
    if (finished) return;
    finished = true;
    release();
    if (how === "cancel" || !ctrl) return;
    try {
      if (how === "close") ctrl.close();
      else ctrl.error(how);
    } catch {
      // The consumer already cancelled: nothing left to tell it.
    }
  };
  // Error the stream (rather than leave it open) so a reader still waiting on it is released.
  const onAbort = () => finish(abortError(opts.signal));

  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        ctrl = controller;
        if (opts.signal?.aborted) return finish(abortError(opts.signal));
        opts.signal?.addEventListener("abort", onAbort, { once: true });
        handle = fs.open(file, "r");
        // Keep an open failure from becoming an unhandled rejection; pull() reports it.
        handle.catch(() => {});
      },
      async pull(controller) {
        if (finished || !handle) return;
        try {
          const want = Math.min(chunkSize, end - pos + 1);
          if (want <= 0) return finish("close");
          const fh = await handle;
          const buf = new Uint8Array(want);
          const { bytesRead } = await fh.read(buf, 0, want, pos);
          if (finished) return; // Cancelled while reading: drop the chunk.
          if (bytesRead === 0) return finish("close");
          pos += bytesRead;
          try {
            controller.enqueue(bytesRead === want ? buf : buf.subarray(0, bytesRead));
          } catch {
            return finish("cancel");
          }
          if (pos > end) finish("close");
        } catch (e) {
          finish(e instanceof Error ? e : new Error(String(e)));
        }
      },
      cancel() {
        finish("cancel");
      },
    },
    // Read one chunk ahead of the consumer, no more.
    { highWaterMark: 1 },
  );
}

function abortError(signal?: AbortSignal): Error {
  const r: unknown = signal?.reason;
  return r instanceof Error ? r : new Error("The client disconnected.");
}
