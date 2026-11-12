# Story capture plan

Goal: get a better story out of the buyer than ForeverSongs does, in about the same time (2 to 3 minutes), and sell the song while we collect it.

ForeverSongs collects three "1 to 2 sentence" text boxes (a 30-character minimum on one of them). In a real test run that produced about 200 characters: "Loving, caring, supports the family", "We met in high school in math class", "Happy birthday baby". We beat that by asking better questions, not more of them.

## Patterns borrowed (Mobbin references)

| Pattern | Seen in | How we use it |
|---|---|---|
| Named chapters in the progress bar, each with an intro card that says why we ask | [Noom onboarding](https://mobbin.com/flows/0592dfbd-aac4-408b-ab48-76334ce7fc11), [Noom behavioral quiz](https://mobbin.com/flows/d7a6d025-2d82-4e5a-9383-cb83579b95f8) | Three chapters: **Who**, **Their story**, **The sound**. The story chapter opens with a card that shows how a detail becomes a lyric. |
| Short praise screens between sections ("Great job, Sam! You have a strong foundation") | [Noom plan setup](https://mobbin.com/flows/0f88ecd3-ceb0-43d1-af33-6feafe56928b) | After a good answer: "That one's going in verse one." Shown inline, not as an extra screen. |
| "Building your plan" screen with a bar per category, then "Based on your answers, Sam…" | [Noom plan setup](https://mobbin.com/flows/0f88ecd3-ceb0-43d1-af33-6feafe56928b), [5 Minute Journal](https://mobbin.com/flows/d1314d72-f008-43e0-8cac-19bef9ae1dd6) | Real lyric-writing stages (10 to 40 s), then "Based on your story, Philip…" and the lyrics appear. |
| A named assistant that asks your name and uses it on the next screen | [ABY Journal](https://mobbin.com/flows/93f83efc-50a0-448f-8a82-a548476b7d0c) | A producer voice runs the interview. The recipient's name appears in every later question. |
| Tappable prompt chips under the input | [Once](https://mobbin.com/screens/9c5d01f9-aec5-4722-8aae-14c6f93cec00) | Sentence starters under every story question ("She always says…", "The first time I…"). |
| Talk or type, with transcription | [5 Minute Journal](https://mobbin.com/screens/34386a9d-210b-4dfc-b34c-f93976cc0709), [pillowtalk](https://mobbin.com/screens/2f89f6df-02f3-4998-8aa1-79de275916de), [stoic.](https://mobbin.com/screens/1dd828f4-5f09-4623-a5fa-42a5173d042a) | A "Hold to talk" button on every story question. The words appear live in the text box so they can fix them. |
| AI voice interview with a visible "Skip interview" | [Mindtrip](https://mobbin.com/screens/3022caa7-dc4d-4dcd-962e-76429b77e35b) | One AI follow-up per answer, always skippable. |
| Emotion words coloured inside the prompt | [How We Feel](https://mobbin.com/screens/d63ed0f4-b06f-4147-a3bf-818ef7832357) | "What do you want Rasheda to *feel*?" with the feeling words styled. |
| Paywall as a checklist plus rating | [Alma paywall](https://mobbin.com/flows/afe2cc2a-7672-43f7-b75c-15c1ff369a52) | Unlock screen lists what they get, with the song's own story details as checklist items. |

## The flow

About 12 screens, roughly 3 minutes. The header always says "about 2 minutes · free preview · no card needed".

### Chapter 1: Who (about 30 s, taps only)

1. **Who's this song for?** Tiles with an emoji: Wife, Husband, Girlfriend, Boyfriend, Mom, Dad, Grandma, Grandpa, Daughter, Son, Sister, Brother, Best friend, Friend, Someone else. One tap moves on.
2. **What's her name?** One big input. A small "Unusual name? Tell us how to say it" link opens the pronunciation field. When they type, a line appears under it: "We'll sing *Rasheda* in the chorus."
3. **What's the occasion?** Tiles. Under them: "When do you need it?" (This week / This month / No rush). This sets up the rush-delivery upsell later.

### Chapter 2: Rasheda's story (about 2 minutes, the heart)

4. **Chapter card.** "Now the good part. The best songs come from small, specific moments. Three quick questions, and you can talk or type." It shows one example of the method:
   > *"She steals my hoodies"* → 🎵 *"You wear my hoodie like it was always yours"*

   This is the sales pitch for the whole product in one picture, and it teaches them what kind of answer works.

5. **Pick what to sing about.** "What should Rasheda's song be about? Pick 2 or 3." Multi-select chips chosen for the relationship. For a partner:
   - How we met · The moment I knew · Her laugh · What she always says · A hard time we got through · Our places · Our kids · Inside joke · What she does for everyone · Our future

   Tapping is easy, and it commits them before any writing. It also decides which questions come next, so every question feels relevant.

6 to 8. **One question per chosen thread.** For example, "How we met":
   - Title: "How did you and Rasheda meet?"
   - Starter chips: "We met at…", "The first thing I noticed was…", "I knew when…"
   - Typing box plus "Hold to talk".
   - A small "Song ingredients" tray at the top fills with chips as details are found ("math class", "high school").
   - **Dig deeper:** if the answer is thin, the producer replies in a chat bubble with one follow-up: "Math class, I love that. What happened that made you notice her?" Answer or **Skip**. One follow-up per question at most, three in total.
   - If the answer is already strong (3 or more details), no follow-up. Instead: "That's a great detail. It's going in verse one."

9. **The one line.** "If this song could say one thing to Rasheda that's hard to say out loud, what would it be?" This replaces ForeverSongs' "message from your heart". It becomes the emotional centre of the chorus.

10. **The feeling.** "When Rasheda hears this, you want her to…": 😭 cry happy tears · 😂 laugh · 🥹 feel proud · ❤️ feel chosen · 🕰️ remember. Below it, optional: "Anything we should leave out?" (an ex, a loss, a nickname she hates). That protects tone and builds trust.

**Story-strength check.** An inline card, not a new screen: "Strong story ✓ Your song will use 6 real details about Rasheda." Next to it, one review from a buyer with the same relationship (a "for my wife" review when they picked Wife). Use only real reviews and real numbers. Leave it out until we have them.

### Chapter 3: The sound (about 30 s)

11. **Genre, language, voice.** Each genre tile has a ▶ that plays a 5-second sample. Voice: Female / Male / Surprise me.
12. **Where should we send Rasheda's song?** Email, optional phone ("get it by text"), and "Who's it from?" (fills `giverName`, so the song can say "from Philip").

### Lyric build, then reveal

- A build screen with real stages: Reading your story ✓ → Picking the 6 details to sing ✓ → Writing the chorus around "Rasheda" … → Checking every line against your story. This is the real `briefing` and `writing_lyrics` work, so it takes the time it takes.
- Then "Based on your story, Philip…" and the lyrics appear line by line, with lines that carry their details highlighted.
- Recording starts automatically and the wait page takes over (video slot, lyrics, offer).

## How it sells while it collects

- **Their own words reflected back:** the name in every question, replies that quote their words, and a tray of ingredients that keeps growing.
- **The method shown up front:** the hoodie example on the chapter card.
- **Easy taps before typing:** picking threads before writing anything.
- **Visible progress toward a strong story:** ingredients and the strength check.
- **Proof matched to them:** a review from someone with the same relationship.
- **Risk reversal repeated at each hard step:** "free preview, no card" under every story question.
- **The lyrics as the reveal:** they see proof before they hear the song or see a price.

## Guardrails

- Skip is always visible on story questions. Follow-ups never block: if the AI hasn't replied within about 1.5 s, move on without it.
- No more than three follow-ups in total. Strong answers get praise, not more questions.
- Occasion "in memory" switches the copy to a gentler tone and hides the 😂 feeling option.
- Voice in the MVP uses the browser's built-in speech recognition (Chrome and Safari). Where it's missing, the button is hidden. A server-side transcription service can come later.

## Backend mapping

| Collected | Goes to |
|---|---|
| Threads, answers and follow-up answers | `story`, written as labelled Q&A blocks (the brief extractor already reads free text) |
| The one line | Brief `mustInclude` and a priority-1 fact |
| Feeling | `mood` |
| Leave out | Brief `avoid` |
| Who it's from | Brief `giverName` |
| Needed by, phone | New columns `needed_by`, `phone` |
| Ingredient chips | Not stored. They come from the follow-up call and are shown only. |

New pieces:

- `POST /api/probe`: a fast, cheap model call that returns `{ reaction, followUp | null, ingredients[] }`. Mock mode returns a simple rule-based version.
- After lyrics are written, recording starts automatically (no approval step). Edits after that trigger a free re-record.
- The existing post-submit follow-up questions stay as a safety net. With follow-ups inside the quiz they should rarely fire.

## What to measure

Log each step to the existing `events` table:

- Drop-off per screen
- Characters and facts per story
- Follow-up answer rate versus skip rate
- Voice versus typing
- Preview-to-purchase rate by story strength

The last one tells us whether a deeper story actually sells more songs.
