/**
 * Home page. A notebook spread: the pitch on the left of the margin line, the objects
 * from a gift drawer floating around it. Everything links into the quiz at /create.
 * Styles: ./home.css (theme tokens only). Art: /public/brand/objects.
 */
import { BRAND } from "@/lib/brand";
import { env } from "@/lib/env";
import { Floaters } from "./home-floaters";
import "./home.css";

export const dynamic = "force-dynamic"; // the price comes from server env

const STEPS = [
  { img: "marker", title: "Tell us about them", body: "A short quiz, one question at a time. Pick the stories worth singing: how you met, the inside joke, the hard year you got through." },
  { img: "cassette", title: "We write it and record it", body: "Your details become lyrics, and every line is checked against what you told us. Then we record two or three versions in the style you picked." },
  { img: "tissues", title: "Press play. Pass the tissues.", body: "Hear the previews free. Keep the one that gets you, change any line you like, and send them a song that's only about them." },
];

const FAQ = [
  { q: "How long does it take?", a: "The quiz takes about two minutes. The lyrics are ready in a minute or two, and the recordings a few minutes after that. You can leave the page and come back." },
  { q: "Do I pay before I hear it?", a: "No. You hear the previews first, for free, and only pay for the version you want to keep." },
  { q: "What if a line isn't right?", a: "Change it. Edit any line and we'll check it and record the song again with your wording." },
  { q: "Who sings it?", a: "The music and vocals are made with AI, from lyrics written for this one song. Nothing is a template with a name dropped in." },
  { q: "What do I get?", a: "The full song as an MP3, plus a page of its own where it plays with the lyrics following along. Share the link or download the file." },
];

export default function Home() {
  const price = env.freeDownloads ? "Free while testing" : env.priceLabel;
  return (
    <div className="home">
      <nav className="home-nav" aria-label="Main">
        <a className="home-brand" href="/">
          {BRAND.name}
        </a>
        <div className="home-nav__links">
          <a href="#how">How it works</a>
          <a href="#faq">Questions</a>
          <a className="home-btn home-btn--sm" href="/create">
            Make a song
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
        <p className="home-note home-hero__note">a song, written from your story</p>
        <h1 className="home-hero__title">
          Songs worth <span className="home-cry">crying</span> over.
        </h1>
        <p className="home-hero__sub">Tell us about someone you love. We write the lyrics from your story, record the song, and you hear it before you pay.</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="home-mascot" src="/brand/mascot/hero.webp" alt="" />
        <div className="home-hero__cta">
          <a className="home-btn" href="/create">
            Start their song
          </a>
          <span className="home-note home-hero__aside">← free preview, no card</span>
        </div>
      </header>

      <ul className="home-facts" aria-label="What you get">
        <li>Every line checked against your story</li>
        <li>Two or three versions to choose from</li>
        <li>Change any line, free</li>
        <li>An MP3 that's yours to keep</li>
      </ul>

      <section className="home-section" id="how" aria-labelledby="how-title">
        <p className="home-note">how it works</p>
        <h2 className="home-h2" id="how-title">
          Three steps from a memory to a song.
        </h2>
        <ol className="home-steps">
          {STEPS.map((s, i) => (
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
          <p className="home-note">your words, in the song</p>
          <h2 className="home-h2" id="words-title">
            The details only you know end up in the chorus.
          </h2>
          <p className="home-p">We ask for small, specific things: a habit, a place, a thing they always say. Those are the lines that land. On your song page, every line that came from your story is highlighted, so you can see exactly where it went.</p>
        </div>
        <figure className="home-words__card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="home-words__photo" src="/brand/objects/polaroid.webp" alt="" loading="lazy" />
          <p className="home-words__from">“He drives us to the coast every August and pretends he isn't crying when the sun goes down.”</p>
          <p className="home-words__arrow" aria-hidden>
            ↓ becomes
          </p>
          <p className="home-words__to">
            Every August, salt on the windshield,
            <br />
            <span className="home-mark home-mark--scroll">you blame the sunset for your eyes</span>
          </p>
          <figcaption className="home-note home-words__cap">example lyric</figcaption>
        </figure>
      </section>

      <section className="home-section home-price" aria-labelledby="price-title">
        <div className="home-price__card">
          <div>
            <p className="home-note">one song, one person</p>
            <h2 className="home-h2" id="price-title">
              {price}
            </h2>
            <p className="home-p">Paid once, after you've heard it.</p>
          </div>
          <ul className="home-checks">
            <li>An original song, written for them</li>
            <li>Two or three versions to pick from</li>
            <li>Edit any line and we re-record</li>
            <li>MP3 download and a song page to share</li>
          </ul>
          <a className="home-btn" href="/create">
            Start their song
          </a>
        </div>
      </section>

      <section className="home-section" id="faq" aria-labelledby="faq-title">
        <p className="home-note">questions</p>
        <h2 className="home-h2" id="faq-title">
          Before you start
        </h2>
        <div className="home-faq">
          {FAQ.map((f) => (
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
          Have tissues ready.
        </h2>
        <p className="home-p">Two minutes of questions. A song they'll keep.</p>
        <a className="home-btn" href="/create">
          Start their song
        </a>
      </section>

      <footer className="home-foot">
        <span className="home-brand">{BRAND.name}</span>
        <span>Songs written from your story.</span>
      </footer>
    </div>
  );
}
