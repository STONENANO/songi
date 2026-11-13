/**
 * Home page. A notebook spread: the pitch in the middle, objects from a gift drawer
 * floating around it. Everything links into the quiz at /create.
 * Styles: ./home.css (theme tokens only). Art: /public/brand.
 *
 * ALL marketing copy lives in COPY below, as placeholders. Fill it in there; the layout
 * reads nothing else. Interface labels (nav, buttons) are in COPY too.
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
  cta: "Call to action",
  hero: {
    note: "Eyebrow note",
    /** The headline in three parts: the middle part gets the blue "crying" treatment. */
    titleStart: "Headline",
    titleAccent: "placeholder",
    titleEnd: "here.",
    sub: "Subheadline placeholder. One or two sentences that explain the product.",
    aside: "← short note",
  },
  facts: ["Proof point one", "Proof point two", "Proof point three", "Proof point four"],
  how: {
    note: "section note",
    title: "Section headline placeholder",
    steps: [
      { img: "marker", title: "Step one title", body: "Step one description placeholder. A sentence or two." },
      { img: "cassette", title: "Step two title", body: "Step two description placeholder. A sentence or two." },
      { img: "tissues", title: "Step three title", body: "Step three description placeholder. A sentence or two." },
    ],
  },
  words: {
    note: "section note",
    title: "Section headline placeholder",
    body: "Body copy placeholder. Two or three sentences that explain this section.",
    from: "“Example detail from a customer's story.”",
    becomes: "↓ becomes",
    lyricLine: "Example lyric line one,",
    lyricHighlight: "example lyric line two",
    caption: "example lyric",
  },
  price: {
    note: "section note",
    sub: "Price subline placeholder.",
    checks: ["Included item one", "Included item two", "Included item three", "Included item four"],
  },
  faq: {
    note: "section note",
    title: "FAQ headline placeholder",
    items: [
      { q: "Question one?", a: "Answer placeholder." },
      { q: "Question two?", a: "Answer placeholder." },
      { q: "Question three?", a: "Answer placeholder." },
      { q: "Question four?", a: "Answer placeholder." },
    ],
  },
  final: { title: "Closing headline placeholder", sub: "Closing subline placeholder." },
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
