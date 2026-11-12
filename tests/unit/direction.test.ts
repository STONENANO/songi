import "../setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { GENRES, VOCAL_PRESETS, ARRANGEMENTS, VOCAL_FORWARD, genreArchetypes, buildMusicDirection, renderStyle, estimateDuration, buildKieInput, GenerationInputError, type Archetype } from "../../src/lib/songcraft";

const sung = "[Verse 1]\n" + "a line of words to sing here\n".repeat(20);
const base = { genreKey: "country", arrangementId: "storytelling", archetype: "signature" as Archetype, mood: "heartfelt", relationship: "mom", occasion: "birthday", vocalGender: "f" as const, customStyle: null };

test("every genre keeps its identity, has 2-3 archetypes, valid arrangements and compatible vocal presets", () => {
  assert.equal(Object.keys(GENRES).length, 12);
  for (const g of Object.values(GENRES)) {
    const arch = genreArchetypes(g);
    assert.ok(arch.length >= 2 && arch.includes("signature"), `${g.key} archetypes`);
    for (const a of g.arrangements) assert.ok(a in ARRANGEMENTS, `${g.key} arrangement ${a}`);
    for (const a of arch) {
      const spec = g.archetypes[a]!;
      for (const gender of ["m", "f"] as const) {
        const p = VOCAL_PRESETS[spec.vocal[gender]];
        assert.equal(p.gender, gender, `${g.key}/${a}/${gender} preset gender`);
        assert.ok((p.genres as readonly string[]).includes(g.key), `${g.key}/${a}/${gender} preset ${spec.vocal[gender]} is not marked compatible`);
      }
    }
    assert.ok(!/truck|porch|kitchen/i.test(g.lyricNotes) || /Do not add/i.test(g.lyricNotes), `${g.key} lyric notes must not suggest scenes`);
  }
});

test("style renders in order: genre, energy+intent, vocal, instruments, production, dynamics", () => {
  const d = buildMusicDirection(base);
  const { style } = renderStyle(d, 1000);
  assert.ok(style.startsWith("heartfelt modern country ballad"), style);
  assert.ok(style.indexOf("heartfelt and grateful") < style.indexOf("country vocal"));
  assert.ok(style.indexOf("country vocal") < style.indexOf("acoustic guitar"));
  assert.ok(!/\[|\]|MAX_MODE|QUALITY|START_ON/i.test(style), "no unsupported bracket commands");
  assert.ok(!/tape hiss|chair creak|mouth noise/i.test(style));
});

test("country celebratory and R&B heartfelt use the mood-aware presets", () => {
  assert.match(renderStyle(buildMusicDirection({ ...base, mood: "celebratory" }), 1000).style, /^upbeat modern country/);
  const rnb = renderStyle(buildMusicDirection({ ...base, genreKey: "rnb", arrangementId: "emotional_ballad" }), 1000).style;
  assert.match(rnb, /warm contemporary soul R&B/);
  assert.match(rnb, /grateful and sincere/);
});

test("romance is never added for a parent, friend or child", () => {
  for (const relationship of ["mom", "friend", "child"]) {
    for (const genreKey of ["rnb", "jazz", "latin_pop"]) {
      const d = buildMusicDirection({ ...base, genreKey, arrangementId: GENRES[genreKey].arrangements[0], mood: "romantic", relationship });
      assert.doesNotMatch(renderStyle(d, 1000).style, /romantic|sensual/i, `${genreKey} for ${relationship}`);
      assert.ok(d.conflicts.some((c) => c.includes("Romantic")));
    }
  }
  const partner = buildMusicDirection({ ...base, genreKey: "rnb", arrangementId: "emotional_ballad", mood: "romantic", relationship: "partner" });
  assert.match(renderStyle(partner, 1000).style, /romantic|sensual/i);
});

test("customer sound notes become constraints; artists are removed; conflicts are recorded", () => {
  const d = buildMusicDirection({ ...base, genreKey: "dance_pop", arrangementId: "celebration", mood: "celebratory", customStyle: "slow piano ballad, no drums, sounds like Adele, with whistling" });
  assert.ok(d.customerConstraints.includes("no drums"));
  assert.ok(d.instrumentation.every((i) => !/drum|kick|claps/i.test(i)));
  assert.ok(d.negativeTags.includes("drums"));
  assert.ok(d.instrumentation.includes("piano") && d.instrumentation.includes("whistling"));
  assert.equal(d.energy, "low");
  assert.ok(d.removedArtistRefs.length > 0);
  assert.ok(d.conflicts.some((c) => c.includes("relies on drums")));
  assert.doesNotMatch(renderStyle(d, 1000).style, /Adele/);
});

test("quiz voice choice wins over conflicting sound notes, explicitly", () => {
  const d = buildMusicDirection({ ...base, vocalGender: "f", customStyle: "deep male voice" });
  assert.equal(d.vocal.gender, "f");
  assert.ok(d.conflicts.some((c) => c.includes("kept the quiz choice")));
});

test("'any' voice alternates across versions", () => {
  const a = buildMusicDirection({ ...base, vocalGender: "any", variantIndex: 0 });
  const b = buildMusicDirection({ ...base, vocalGender: "any", variantIndex: 1 });
  assert.notEqual(a.vocal.gender, b.vocal.gender);
});

test("over-long styles drop whole optional segments and never cut customer notes", () => {
  const d = buildMusicDirection({ ...base, customStyle: "a warm hazy late summer evening feel " + "x".repeat(40) });
  const full = renderStyle(d, 1000).style.length;
  const limit = full - 30;
  const tight = renderStyle(d, limit);
  assert.ok(tight.style.length <= limit);
  assert.ok(tight.style.includes(d.customerNotes), "customer notes kept whole");
  assert.ok(tight.dropped.length > 0);
  assert.throws(() => renderStyle(d, 60), /Required style content/);
});

test("duration is estimated from lyrics and clamped only as a number", () => {
  const short = estimateDuration("[Verse]\nla la", ARRANGEMENTS.storytelling, "medium");
  const long = estimateDuration("word ".repeat(2000), ARRANGEMENTS.storytelling, "medium");
  assert.equal(short, ARRANGEMENTS.storytelling.duration[0]);
  assert.equal(long, ARRANGEMENTS.storytelling.duration[1]);
  const rap = estimateDuration("word ".repeat(300), ARRANGEMENTS.rhythmic_rap, "medium");
  assert.ok(rap >= 140 && rap <= 200);
});

test("Kie input: vocal preference propagates, unsupported fields are omitted, limits fail loudly", () => {
  const opts = { genreKey: "country", vocalGender: "m" as const, mood: "heartfelt", customStyle: null, title: "T", sungLyrics: sung, kieModel: "V6", arrangementId: "storytelling", archetype: "intimate" as Archetype, relationship: "mom", occasion: "birthday" };
  const v6 = buildKieInput(opts);
  assert.equal(v6.input.vocal_gender, "m");
  assert.ok(v6.input.duration && v6.input.duration >= 150);
  assert.equal(v6.direction?.archetype, "intimate");
  const v5 = buildKieInput({ ...opts, kieModel: "V5", allowedModels: ["V5"] });
  assert.equal(v5.input.duration, undefined, "duration omitted for models without support");
  assert.throws(() => buildKieInput({ ...opts, kieModel: "V3" }), (e: unknown) => e instanceof GenerationInputError && e.code === "model_not_allowed");
  assert.throws(() => buildKieInput({ ...opts, sungLyrics: "x".repeat(5001) }), (e: unknown) => e instanceof GenerationInputError && e.code === "lyrics_over_limit");
  const any = buildKieInput({ ...opts, vocalGender: "any" });
  assert.ok(any.input.vocal_gender === "f" || any.input.vocal_gender === "m");
});

test("legacy direction mode reproduces the v1 style string (for A/B) without truncation", () => {
  const r = buildKieInput({ genreKey: "country", vocalGender: "f", mood: "heartfelt", customStyle: null, title: "T", sungLyrics: sung, kieModel: "V6", directionMode: "legacy" });
  assert.match(r.input.style, /^modern country, acoustic and electric guitar/);
  assert.equal(r.direction, null);
});

test("every style prompt asks for a vocal-forward mix early, and keeps it even when space runs out", () => {
  for (const g of Object.values(GENRES)) {
    for (const a of genreArchetypes(g)) {
      for (const gender of ["m", "f"] as const) {
        const d = buildMusicDirection({ ...base, genreKey: g.key, arrangementId: g.arrangements[0], archetype: a, vocalGender: gender });
        const { style } = renderStyle(d, 1000);
        const at = style.indexOf(VOCAL_FORWARD);
        assert.ok(at >= 0, `${g.key}/${a}/${gender}: ${style}`);
        assert.ok(at < 200, `${g.key}/${a}: vocal-forward should come early (at ${at})`);
        assert.doesNotMatch(style, /stacked harmonies|wide arena mix|big live drums|hard-hitting drums|massive choir|deep bass|lush layered harmonies|backing vocal stacks|club-ready|synth leads|supersaw|full horn section|group backing vocals/, `${g.key}/${a}`);
        const tight = renderStyle(d, 320);
        assert.ok(tight.style.includes(VOCAL_FORWARD), `${g.key}/${a}: kept under a tight limit`);
        assert.ok(tight.style.length <= 320);
      }
    }
  }
});
