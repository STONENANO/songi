/**
 * Home page. A notebook spread: the pitch in the middle, objects from a gift drawer
 * floating around it. Everything links into the quiz at /create.
 * Styles: ./home.css (theme tokens only). Art: /public/brand.
 *
 * ALL marketing copy lives in COPY below; the layout reads nothing else. Interface labels
 * (nav, buttons) are in COPY too. Written to the ConversionAlchemy standards from competitor
 * review language (Songfinch, ForeverSongs on Trustpilot) until our own reviews exist.
 * Replace with real customer words and real reviews as they come in.
 */
import { BRAND } from "@/lib/brand";
import { env } from "@/lib/env";
import { Floaters } from "./home-floaters";
import { SiteFooter } from "@/components/legal";
import { getSongPrice } from "@/lib/commerce/pricing";
import "./home.css";

export const dynamic = "force-dynamic"; // the price comes from server env

const COPY = {
  nav: { how: "How it works", faq: "Questions", cta: "Make a song" },
  cta: "Start their song",
  hero: {
    note: "for the people who mean everything",
    /** The headline in three parts: the middle part gets the blue "crying" treatment. */
    titleStart: "Make them",
    titleAccent: "cry",
    titleEnd: "happy tears.",
    sub: "Tell us the little things only you know. We turn them into an original song about them, and you hear it free before you pay.",
    aside: "← about 2 minutes, no card",
  },
  facts: ["Hear it free before you pay", "Ready in minutes, not a week", "Built from your real details", "12 styles, from country to lullaby"],
  how: {
    note: "how it works",
    title: "Three steps to their song",
    steps: [
      { img: "marker", title: "Tell us their story", body: "A few quick questions: who it's for, the moments you'll never forget, the things only they do. Inside jokes welcome." },
      { img: "cassette", title: "Hear your versions", body: "In about five minutes we write the lyrics and record a few versions in the style you pick. Listen to all of them free." },
      { img: "tissues", title: "Pick one and give it", body: "Choose the one that gives you chills. You get the full song, an MP3 and a link to share. Then hand them the tissues." },
    ],
  },
  words: {
    note: "the little details",
    title: "Your words end up in the song",
    body: "A song that could be about anyone won't make anyone cry. Every song starts from the details you share, so the line about Sunday pancakes is about her Sunday pancakes. You read every lyric before you buy, and you can change any line that isn't right.",
    from: "“She makes pancakes every Sunday and sings off-key in the car.”",
    becomes: "↓ becomes",
    lyricLine: "Flour on your sleeves every Sunday morning,",
    lyricHighlight: "singing off-key like the radio's yours",
    caption: "an example story and lyric",
  },
  price: {
    note: "what you get",
    sub: "One original song, written and recorded for one person. You only pay once you've heard it.",
    checks: ["The full song, every verse", "MP3 download, yours to keep", "A permanent link to share it", "Lyrics that play along on screen"],
  },
  faq: {
    note: "before you start",
    title: "Questions people ask first",
    items: [
      {
        q: "Is it really about them, or a template?",
        a: "It's built from your answers. The names, places, sayings and inside jokes you share go into the lyrics, and every song is checked against your story before it's recorded. You read every line before you pay, and you can change any line that's off.",
      },
      {
        q: "What if I don't love it?",
        a: "You hear the versions free first, so you only pay for one you like. Not quite right? Change a line or ask for another take. If something's still wrong after you buy, we'll fix it or refund you in full within 14 days.",
      },
      {
        q: "How long does it take?",
        a: "About 2 minutes to tell us the story, then around 5 minutes while we write and record. We email you the link when it's ready, so you can close the page and come back.",
      },
      {
        q: "Is it made with AI?",
        a: "Yes. The songwriting and singing use AI, guided by your story, and every lyric is checked against what you told us before it's recorded. That's how we can make it in minutes and let you hear it before you pay.",
      },
    ],
  },
  final: { title: "Somebody's about to cry happy tears.", sub: "Start with their name. The rest takes about two minutes." },
};

export default async function Home() {
  const price = env.freeDownloads ? "Free while testing" : (await getSongPrice()).label;
  return (
    <div className="home">
      <nav className="home-nav" aria-label="Main">
        <a className="home-brand" href="/">
          {BRAND.name}
        </a>
        <div className="home-nav__links">
          <a href="#how">{COPY.nav.how}</a>
          <a href="#faq">{COPY.nav.faq}</a>
          <a className="home-btn home-btn--sm" href="/create">
            {COPY.nav.cta}
          </a>
        </div>
      </nav>

      <header className="home-hero">
        <Floaters />
        <div className="home-tears" aria-hidden>
          <i />
          <i />
          <i />
          <i />
        </div>
        <p className="home-note home-hero__note">{COPY.hero.note}</p>
        <h1 className="home-hero__title">
          {COPY.hero.titleStart} <span className="home-cry">{COPY.hero.titleAccent}</span> {COPY.hero.titleEnd}
        </h1>
        <p className="home-hero__sub">{COPY.hero.sub}</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="home-mascot" src="/brand/mascot/hero.webp" alt="" />
        <div className="home-hero__cta">
          <a className="home-btn" href="/create">
            {COPY.cta}
          </a>
          <span className="home-note home-hero__aside">{COPY.hero.aside}</span>
        </div>
      </header>

      <ul className="home-facts">
        {COPY.facts.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>

      <section className="home-section" id="how" aria-labelledby="how-title">
        <p className="home-note">{COPY.how.note}</p>
        <h2 className="home-h2" id="how-title">
          {COPY.how.title}
        </h2>
        <ol className="home-steps">
          {COPY.how.steps.map((s, i) => (
            <li key={s.title} className="home-step">
              <span className="home-step__n" aria-hidden>
                {i + 1}.
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="home-step__img" src={`/brand/objects/${s.img}.webp`} alt="" loading="lazy" />
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="home-section home-words" aria-labelledby="words-title">
        <div className="home-words__copy">
          <p className="home-note">{COPY.words.note}</p>
          <h2 className="home-h2" id="words-title">
            {COPY.words.title}
          </h2>
          <p className="home-p">{COPY.words.body}</p>
        </div>
        <figure className="home-words__card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="home-words__photo" src="/brand/objects/polaroid.webp" alt="" loading="lazy" />
          <p className="home-words__from">{COPY.words.from}</p>
          <p className="home-words__arrow" aria-hidden>
            {COPY.words.becomes}
          </p>
          <p className="home-words__to">
            {COPY.words.lyricLine}
            <br />
            <span className="home-mark">{COPY.words.lyricHighlight}</span>
          </p>
          <figcaption className="home-note home-words__cap">{COPY.words.caption}</figcaption>
        </figure>
      </section>

      <section className="home-section home-price" aria-labelledby="price-title">
        <div className="home-price__card">
          <div>
            <p className="home-note">{COPY.price.note}</p>
            <h2 className="home-h2" id="price-title">
              {price}
            </h2>
            <p className="home-p">{COPY.price.sub}</p>
          </div>
          <ul className="home-checks">
            {COPY.price.checks.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <a className="home-btn" href="/create">
            {COPY.cta}
          </a>
        </div>
      </section>

      <section className="home-section" id="faq" aria-labelledby="faq-title">
        <p className="home-note">{COPY.faq.note}</p>
        <h2 className="home-h2" id="faq-title">
          {COPY.faq.title}
        </h2>
        <div className="home-faq">
          {COPY.faq.items.map((f) => (
            <details key={f.q} className="home-faq__item">
              <summary>{f.q}</summary>
              <div className="home-faq__a">
                <p>{f.a}</p>
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="home-final" aria-labelledby="final-title">
        <div className="home-final__row" aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="home-final__img" src="/brand/objects/tissues.webp" alt="" loading="lazy" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="home-final__mascot" src="/brand/mascot/headphones.webp" alt="" loading="lazy" />
        </div>
        <h2 className="home-h2" id="final-title">
          {COPY.final.title}
        </h2>
        <p className="home-p">{COPY.final.sub}</p>
        <a className="home-btn" href="/create">
          {COPY.cta}
        </a>
      </section>

      <SiteFooter />
    </div>
  );
}
