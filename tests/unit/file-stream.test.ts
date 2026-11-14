import "../setup";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileStream, FILE_STREAM_CHUNK } from "../../src/lib/http/file-stream";
import { issueMediaToken } from "../../src/lib/media/tokens";
import { getStorage } from "../../src/lib/storage";
import { GET as mediaGET } from "../../src/app/api/media/[token]/route";

/**
 * Client disconnects must never surface as "Invalid state: Controller is already closed".
 * (Node's Readable.toWeb adapter, which the media route used before, throws exactly that
 * from an event handler when the browser aborts an audio request mid-download.)
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "file-stream-"));
const bytes = crypto.randomBytes(FILE_STREAM_CHUNK * 20 + 123);
const file = path.join(dir, "song.bin");
fs.writeFileSync(file, bytes);

// Count every FileHandle read/close the stream makes, to prove reading stops and the file is released.
let reads = 0;
let closes = 0;
const origOpen = fs.promises.open;
fs.promises.open = (async (...args: Parameters<typeof origOpen>) => {
  const fh = await origOpen(...args);
  const read = fh.read.bind(fh) as (...a: unknown[]) => unknown;
  const close = fh.close.bind(fh);
  Object.assign(fh, {
    read: (...a: unknown[]) => (reads++, read(...a)),
    close: () => (closes++, close()),
  });
  return fh;
}) as typeof origOpen;
after(() => {
  fs.promises.open = origOpen;
});

/** Collects uncaught exceptions while `fn` runs, plus a settling period after it. */
async function catchingUncaught(fn: () => Promise<void>): Promise<Error[]> {
  const seen: Error[] = [];
  const onErr = (e: Error) => seen.push(e);
  process.on("uncaughtException", onErr);
  try {
    await fn();
    await sleep(100);
  } finally {
    process.off("uncaughtException", onErr);
  }
  return seen;
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function readAll(s: ReadableStream<Uint8Array>): Promise<Buffer> {
  const parts: Uint8Array[] = [];
  for await (const c of s as unknown as AsyncIterable<Uint8Array>) parts.push(c);
  return Buffer.concat(parts);
}

test("streams the whole file and byte ranges exactly", async () => {
  assert.ok((await readAll(fileStream(file))).equals(bytes));
  assert.ok((await readAll(fileStream(file, { start: 10, end: 99 }))).equals(bytes.subarray(10, 100)));
  const s = FILE_STREAM_CHUNK - 5;
  const e = FILE_STREAM_CHUNK * 3 + 7;
  assert.ok((await readAll(fileStream(file, { start: s, end: e }))).equals(bytes.subarray(s, e + 1)));
  assert.equal((await readAll(fileStream(file, { start: bytes.length - 1 }))).length, 1);
});

test("reader.cancel() mid-way: no exception escapes, reading stops, the file is closed", async () => {
  const closesBefore = closes;
  let readsAtCancel = 0;
  const errors = await catchingUncaught(async () => {
    const reader = fileStream(file).getReader();
    await reader.read();
    await reader.read();
    await reader.cancel();
    readsAtCancel = reads;
    // A cancelled stream reports done, and late chunks are not delivered.
    assert.deepEqual(await reader.closed, undefined);
  });
  assert.deepEqual(errors, []);
  assert.equal(reads, readsAtCancel, "no file reads after cancel");
  assert.equal(closes, closesBefore + 1, "file handle closed once");
});

test("cancelling with a read in flight drops the chunk instead of enqueueing after close", async () => {
  const closesBefore = closes;
  const errors = await catchingUncaught(async () => {
    const s = fileStream(file);
    const reader = s.getReader();
    const pending = reader.read(); // pull() is now awaiting fh.read()
    await reader.cancel();
    assert.deepEqual(await pending, { done: true, value: undefined });
  });
  assert.deepEqual(errors, []);
  assert.equal(closes, closesBefore + 1);
});

test("an aborted signal (req.signal on client disconnect) stops reading and closes the file", async () => {
  const closesBefore = closes;
  let readsAtAbort = 0;
  const errors = await catchingUncaught(async () => {
    const ac = new AbortController();
    const reader = fileStream(file, { signal: ac.signal }).getReader();
    await reader.read();
    ac.abort();
    readsAtAbort = reads;
    // The stream is errored, so a reader still waiting on it is released, not left hanging.
    await assert.rejects(reader.read());
    await sleep(50);
  });
  assert.deepEqual(errors, []);
  assert.ok(reads <= readsAtAbort + 1, "at most the read already in flight completes");
  assert.equal(closes, closesBefore + 1);
});

test("hundreds of random-time aborts (the production crash pattern) never throw", async () => {
  const small = path.join(dir, "small.bin");
  fs.writeFileSync(small, bytes.subarray(0, 5000));
  const errors = await catchingUncaught(async () => {
    for (let i = 0; i < 300; i++) {
      const ac = new AbortController();
      const src = fileStream(i % 2 ? file : small, i % 3 ? {} : { start: 0, end: 1000 });
      const sink = new WritableStream({ write: () => sleep(Math.random() * 3) });
      const piped = src.pipeTo(sink, { signal: ac.signal }).catch(() => {});
      setTimeout(() => ac.abort(new Error("client went away")), Math.random() * 10);
      await piped;
    }
  });
  assert.deepEqual(errors, [], errors.map((e) => e.message).join("; "));
});

test("media route: client abort mid-download (Range and full) does not throw", async () => {
  const key = "requests/stream-test/v1/preview.mp3";
  const storage = await getStorage();
  await storage.putFile(key, file, "audio/mpeg");
  const token = issueMediaToken({ key, kind: "preview", ttlSec: 600 });
  const errors = await catchingUncaught(async () => {
    for (const range of [undefined, "bytes=0-", `bytes=100-${FILE_STREAM_CHUNK * 4}`]) {
      const ac = new AbortController();
      const req = new Request(`http://localhost/api/media/${token}`, { signal: ac.signal, headers: range ? { range } : {} });
      const res = await mediaGET(req, { params: Promise.resolve({ token }) });
      assert.equal(res.status, range ? 206 : 200);
      const reader = res.body!.getReader();
      const first = await reader.read();
      assert.ok(first.value && first.value.byteLength > 0);
      // The browser disconnects: Next aborts req.signal and cancels the body.
      ac.abort();
      await reader.cancel(new Error("aborted")).catch(() => {});
    }
    // The crash pattern: the response body is piped out and the client drops at a random moment.
    for (let i = 0; i < 200; i++) {
      const ac = new AbortController();
      const range = i % 2 ? { range: "bytes=0-" } : undefined;
      const req = new Request(`http://localhost/api/media/${token}`, { signal: ac.signal, headers: range });
      const res = await mediaGET(req, { params: Promise.resolve({ token }) });
      const sink = new WritableStream({ write: () => sleep(Math.random() * 3) });
      const piped = res.body!.pipeTo(sink, { signal: ac.signal }).catch(() => {});
      setTimeout(() => ac.abort(new Error("client went away")), Math.random() * 10);
      await piped;
    }
    // And a full read still delivers every byte.
    const res = await mediaGET(new Request(`http://localhost/api/media/${token}`), { params: Promise.resolve({ token }) });
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(bytes));
  });
  assert.deepEqual(errors, [], errors.map((e) => e.message).join("; "));
});
