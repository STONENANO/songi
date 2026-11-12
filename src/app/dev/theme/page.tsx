"use client";
/**
 * Style preview: every shared UI piece in its main states, on one page.
 * Use it to check a re-skin (theme.css / ui.css) without clicking through the quiz.
 */
import { useState } from "react";
import {
  Banner,
  Bubble,
  Button,
  Card,
  Checklist,
  Chip,
  Chips,
  DetailToLyric,
  ErrorText,
  Field,
  IngredientsTray,
  Lyrics,
  Note,
  ProgressBar,
  Screen,
  ScreenTitle,
  Stages,
  StudioCard,
  MascotStage,
  MASCOT_CLIPS,
  type MascotClip,
  TextArea,
  TextInput,
  Tile,
  Tiles,
  Tip,
  TrustRow,
} from "@/components/ui";

const TOKENS = ["--color-bg", "--color-surface", "--color-surface-muted", "--color-border", "--color-text", "--color-text-muted", "--color-primary", "--color-primary-soft", "--color-highlight", "--color-success", "--color-danger", "--color-dark-surface"];

export default function ThemePreview() {
  const [tile, setTile] = useState("a");
  const [multi, setMulti] = useState<string[]>(["x"]);
  const [chip, setChip] = useState("1");
  return (
    <Screen chapters={[{ label: "Who it's for", progress: 1 }, { label: "Their story", progress: 0.4 }, { label: "The sound", progress: 0 }]} activeChapter={1} onBack={() => {}} footer={<><Button block>Primary action</Button><TrustRow items={["About 2 minutes", "Free preview", "No card needed"]} /></>}>
      <ScreenTitle eyebrow="Eyebrow" title="Screen title in the display font" subtitle="Subtitle in the body font, muted." />

      <Card title="Colour tokens">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
          {TOKENS.map((t) => (
            <div key={t} style={{ fontSize: 11 }}>
              <div style={{ height: 36, borderRadius: 8, background: `var(${t})`, border: "1px solid var(--color-border)" }} />
              {t}
            </div>
          ))}
        </div>
      </Card>

      <Card title="Buttons">
        <div className="ui-row">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="text">Text</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Card>

      <Card title="Tiles">
        <Tiles>
          <Tile emoji="💍" label="Single, selected" selected={tile === "a"} onClick={() => setTile("a")} />
          <Tile emoji="🌷" label="Single" sub="With a subline" selected={tile === "b"} onClick={() => setTile("b")} />
          {["x", "y"].map((k) => (
            <Tile key={k} multi emoji="✨" label={`Multi ${k}`} selected={multi.includes(k)} onClick={() => setMulti((m) => (m.includes(k) ? m.filter((v) => v !== k) : [...m, k]))} />
          ))}
        </Tiles>
      </Card>

      <Card title="Chips">
        <Chips>
          {["1", "2"].map((k) => (
            <Chip key={k} selected={chip === k} onClick={() => setChip(k)}>Chip {k}</Chip>
          ))}
          <Chip ghost onClick={() => {}}>Sentence starter…</Chip>
        </Chips>
      </Card>

      <Card title="Fields">
        <TextInput hero placeholder="Hero input" />
        <div className="ui-mt" />
        <Field label="Label" hint="Hint text" error="Error text">
          <TextInput placeholder="Input" />
        </Field>
        <TextArea placeholder="Text area" />
        <div className="ui-mt"><Tip>Tip with an icon.</Tip></div>
      </Card>

      <Card title="Interview">
        <IngredientsTray items={["math class", "she's my everything", "Sunday pancakes"]} strength={3} />
        <Bubble typing />
        <Bubble>
          <p style={{ marginBottom: 6 }}>Math class, I love that.</p>
          <b>What happened that made you notice her?</b>
        </Bubble>
        <DetailToLyric from="She steals my hoodies" to="You wear my hoodie like it was always yours" />
      </Card>

      <Card title="Progress">
        <Stages items={[{ label: "Done stage", state: "done" }, { label: "Active stage", state: "active" }, { label: "Upcoming stage", state: "todo" }]} />
        <div className="ui-mt"><ProgressBar value={0.42} label="Recording vocals" /></div>
      </Card>

      <MascotPreview />
      <div className="ui-mt" />
      <StudioCard messages={["Recording Rasheda's song", "Singing about “math class”"]} sub="R&B · written for Rasheda" />

      <Card title="Lyrics">
        <Lyrics
          legend="Highlighted lines came from your story. Tap one."
          sections={[{ tag: "Chorus", lines: [{ text: "Rasheda, this one is for you" }, { text: "From a math class seat to a lifetime too", source: "We met in high school in math class" }] }]}
        />
      </Card>

      <Card tone="muted" title="Muted card">
        <Checklist items={["Checklist item", "Another item"]} />
      </Card>
      <Card tone="dark" title="Dark card"><Note>Note text</Note></Card>
      <Banner>Banner</Banner>
      <ErrorText>Error message</ErrorText>
      <p className="ui-pointer">👇 Pointer bar</p>
    </Screen>
  );
}

/** Every wait-screen clip, switchable, so a re-skin can check each one. */
function MascotPreview() {
  const [clip, setClip] = useState<MascotClip>("writing");
  return (
    <div className="ui-stack">
      <MascotStage clip={clip} label={`Clip: ${clip}`} rec={clip !== "writing"} />
      <Chips>
        {MASCOT_CLIPS.map((c) => (
          <Chip key={c} selected={c === clip} onClick={() => setClip(c)}>
            {c}
          </Chip>
        ))}
      </Chips>
    </div>
  );
}
