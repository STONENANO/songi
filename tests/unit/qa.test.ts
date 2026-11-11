import "../setup";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { technicalQa } from "../../src/lib/audio/qa";
import { run, makeTestTone } from "../../src/lib/audio/ffmpeg";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-"));
const f = (n: string) => path.join(dir, n);

before(async () => {
  await makeTestTone(f("good.mp3"), 90, 330);
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", "90", "-codec:a", "libmp3lame", "-q:a", "6", f("silent.mp3")]);
  await makeTestTone(f("short.mp3"), 20, 330);
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=90", "-af", "volume=30", "-codec:a", "libmp3lame", "-q:a", "6", f("clipped.mp3")]);
  // Tone, 15 s of digital silence, tone.
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=40", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-f", "lavfi", "-i", "sine=frequency=330:duration=40", "-filter_complex", "[1]atrim=0:15[s];[0][s][2]concat=n=3:v=0:a=1", "-codec:a", "libmp3lame", "-q:a", "6", f("gap.mp3")]);
  fs.writeFileSync(f("corrupt.mp3"), crypto.randomBytes(80_000));
  const good = fs.readFileSync(f("good.mp3"));
  fs.writeFileSync(f("truncated.mp3"), good.subarray(0, Math.floor(good.length / 6)));
});

test("a clean track passes", async () => {
  const q = await technicalQa(f("good.mp3"), { requestedDuration: 120 });
  assert.equal(q.pass, true, q.reasons.join("; "));
  assert.ok(q.duration > 85);
});

test("silence, short audio, clipping, internal gaps and corrupt or truncated files fail", async () => {
  for (const [name, re] of [
    ["silent.mp3", /silent|silence/],
    ["short.mp3", /seconds long/],
    ["clipped.mp3", /clipping/i],
    ["gap.mp3", /silence in the middle/],
    ["corrupt.mp3", /readable|Unsupported|decode|no duration/i],
    ["truncated.mp3", /Incomplete file|under half|seconds long/],
  ] as const) {
    const q = await technicalQa(f(name), { requestedDuration: 90 });
    assert.equal(q.pass, false, `${name} should fail`);
    assert.match(q.reasons.join(" "), re, `${name}: ${q.reasons.join("; ")}`);
  }
});

test("the delivered MP3 carries the customer's title and lyrics, not the provider's sung respellings", async () => {
  const { normalizeToMp3, cutPreview, run } = await import("../../src/lib/audio/ffmpeg");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "id3-"));
  const src = path.join(dir, "src.mp3");
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-metadata", "title=Provider Title", "-metadata", "lyrics-eng=Shiv-awn, sit back", "-c:a", "libmp3lame", src]);
  const full = path.join(dir, "full.mp3");
  await normalizeToMp3(src, full, { title: "Porch Light Song", lyrics: "[Chorus]\nSiobhan, sit back" });
  const tags = async (f: string) => (await run("ffprobe", ["-v", "error", "-show_entries", "format_tags", "-of", "json", f])).stdout;
  const t = await tags(full);
  assert.match(t, /Porch Light Song/);
  assert.match(t, /Siobhan, sit back/);
  assert.doesNotMatch(t, /Shiv-awn|Provider Title/);
  const prev = path.join(dir, "preview.mp3");
  await cutPreview(src, prev, 0, 2);
  assert.doesNotMatch(await tags(prev), /Shiv-awn|Provider Title/);
});
