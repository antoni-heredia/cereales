---
name: summarise-transcript
description: >-
  Turns a cereales meeting transcript into a structured summary — decisions,
  action items, context, open questions — written into that day's diary note in
  the Obsidian vault, and then tags the transcript so it is not summarised
  twice. Use this whenever the user mentions summarising or "resumir" a
  meeting, a recording or a transcript; asks what was decided in a meeting,
  what came out of it or what is still pending from it; asks to process,
  catch up on or go through the transcripts they have not looked at yet; or
  points at a note under a `transcripts/` folder. Use it too when they simply
  say a meeting is over and they want it written up, even if the words
  "transcript" or "summary" never appear.
---

# Summarising a cereales transcript

cereales records a meeting, transcribes it locally and writes a Markdown note
into the user's Obsidian vault. What it deliberately does not do is tell them
what the meeting *meant* — the transcript is literal, an hour of speech written
down, and nobody rereads that. This skill is the step that turns it into the
handful of lines somebody would actually want next week: what was decided, who
owes what, and what is still open.

The summary is a judgement about a meeting the app did not attend, which is why
it lives in the user's own daily note rather than being written back into the
transcript. A bad summary has to be throwable away without taking the
recording, the transcript or the notes with it.

## What the input looks like

A transcript note is plain Markdown with frontmatter cereales wrote:

```markdown
---
date: 2026-08-03
duration: "24:10"
source: cereales
audio: "audio/recording-1754215200.wav"
tags:
  - meeting
---

# Weekly product sync

![[recording-1754215200.wav]]

## Transcript

**00:08** — **Ana:** Let us start with last week's retention numbers.

> [!note] 00:40
> Look into why 7-day retention dropped

**00:42** — **Diego:** Seven-day retention dropped two points versus last month.
```

Two things about it matter more than they look:

- **`source: cereales` is the marker.** It is what tells one of these notes
  apart from the rest of a vault. Never guess from the folder alone.
- **The `> [!note]` callouts are not part of the transcript.** They are what a
  human chose to type *while the meeting was happening*, anchored to the second
  they typed it. Somebody bothering to write something down mid-meeting is the
  strongest signal in the file — weight those far above the surrounding speech.
  A summary that contradicts the notes is almost always wrong.

Speaker names are often absent: whisper.cpp does not tell voices apart, so most
local transcripts are unattributed lines. Only ElevenLabs produces names, and
they are `Speaker 1`, `Speaker 2` — labels, not people.

## 1. Find what to summarise

If the user pointed at a specific note, use that one. Otherwise list what is
pending:

```bash
node .claude/skills/summarise-transcript/scripts/pending.mjs
```

It reads the vault path out of the app's own settings, walks the notes, and
prints the ones that carry `source: cereales` without the `cereales/summarised`
tag — plus, for each, which daily note its date maps to and whether that note
exists. Add `--json` when you want to consume it, `--all` to include the ones
already done, `--vault <path>` to override the discovery.

If several are pending, show the list and summarise them oldest first, one at a
time. Do not ask the language question once per note — ask once for the batch.

Nothing pending is a perfectly good answer. Say so and stop.

## 2. Ask what language to write in

Ask before writing, but ask with an answer already in hand: read enough of the
transcript to see what language the meeting was held in, and offer that.

> The meeting is in Spanish. Summary in Spanish, or would you rather have it in
> another language?

This is worth a question rather than a guess because the summary is what gets
reread, and a vault kept in one language does not want the odd note in another.
Whatever the answer, the *structure* below stays the same — only the headings
and the prose change language.

## 3. Read it properly before writing

Read the whole note. Then, before writing anything:

- **Start from the callouts.** List the notes the user typed during the
  meeting. Each one is a claim about what mattered, with a timestamp. Every one
  of them should be traceable in the summary — as a decision, an action, or a
  question. If one has no home in your summary, the summary is missing
  something.
- **Find where each note's subject was actually discussed.** The note at
  `04:55` refers to something being said around then; the surrounding lines are
  what give it the detail the user did not have time to type.
- **Keep the timestamps that earn their place.** `(12:30)` next to a decision
  is what makes the transcript seekable — the whole point of the recording is
  that a reader can go and hear the sentence. Use them for decisions and
  anything contested, not for every line.
- **Watch for whisper's mishearings.** Names, product names and jargon come out
  mangled, often several different ways in the same file. When the notes and
  the transcript disagree on a spelling, the notes are the human and they win.
  Screenshots embedded in a note (`![[…-shot-01.png]]`) frequently hold the
  correct spelling of what was on screen — say so rather than guessing.

## 4. Where the summary goes

Into the daily note for the transcript's `date` — the script reports its exact
path and whether it exists. This is the user's existing habit: the day's note is
where they already record what happened, so a meeting write-up belongs as a
section inside it rather than as another loose file.

- **The note exists** → add the meeting section to it. If it has an obvious log
  section for the day (a "Bitácora", "Log", "Journal" heading — something whose
  job is "what happened today"), put the meeting under that. Otherwise append at
  the end. Never reorganise what is already in the note.
- **The note does not exist** → create it. If the vault has a daily note
  template (the script reports it, from `.obsidian/daily-notes.json`), start
  from that template and fill in the `{{date:…}}` placeholders you can resolve;
  leave the rest of its structure alone, empty sections included, because that
  scaffolding is the user's and they fill it in themselves.
- **A section for this meeting is already there** (a re-run, or a
  re-transcription) → replace that section in place instead of appending a
  second copy.

## 5. The shape of the summary

```markdown
## Meeting: {title}

**With:** {names, if they are actually known}
**Duration:** {duration}
**Transcript:** [[{note name}|Full transcript and notes]]

### Decisions

- **{the decision, in bold}**: what it commits to, and the reasoning if it was
  given. `(12:30)` when hearing it back would help.

### Action items

| What | Who | When |
|---|---|---|
| {the task, phrased as something you could start doing} | {name or —} | {date or —} |

### Context

- {what a reader needs to make sense of the decisions: constraints, numbers,
  systems, who else is involved}

### Personal notes

- {what was said *to* the user rather than agreed by the room: advice,
  warnings, how things work here, ideas explicitly parked as "not now"}

### Open questions

- {what was raised and not settled — including anything the user typed as a
  note that never got an answer in the room}
```

In Spanish, the same skeleton reads: `## Reunión: …`, `**Con:** / **Duración:**
/ **Transcripción:**`, `### Decisiones`, `### Acciones pendientes` (columns
`Qué | Quién | Cuándo`), `### Contexto`, `### Notas personales`, `### Dudas`.
Keep those exact headings so notes stay consistent across the vault.

**Context and personal notes are not the same drawer.** Context is what a
reader needs in order to follow the decisions — systems, numbers, who else is
involved. Personal notes are the things somebody told the user that they will
want again long after this project is over: "never commit to anything in an
informal conversation with business", "do not sink hours into Jira, we are
three people". Filing that kind of advice under Context buries it among API
names, and it is usually the part of a meeting that is still worth something in
a year. This section is empty more often than not, and that is fine — drop it
when nobody said anything of the sort.

**Drop a section that has nothing real in it.** An empty "Decisions" heading is
worse than no heading: it reads as "no decisions were taken" when it usually
means "the meeting was a status update". A summary of a 20-minute catch-up can
legitimately be a title, a link and four bullets.

## 6. Mark it done

Once the summary is written:

```bash
node .claude/skills/summarise-transcript/scripts/pending.mjs --mark "<path to the transcript note>"
```

That adds `cereales/summarised` to the transcript's frontmatter, which is what
keeps it off the pending list next time. It is idempotent, so running it again
costs nothing.

Do this **after** the summary is on disk, never before: a tag saying a summary
exists when it does not is worse than doing the work twice. If the user asked
for a draft to look at rather than something filed, do not tag at all — say
that you have not, so they know it is still pending.

Re-transcribing a recording rewrites its note from scratch and the tag goes with
it. That is the right behaviour: a new transcript deserves a fresh look.

## Judgement calls worth getting right

**Do not invent owners or dates.** An action item with the wrong name on it is
actively harmful — somebody reads it, assumes it is handled, and it is not.
Attribute a task only when the transcript actually says who takes it, and leave
the cell as `—` otherwise. Same for deadlines: "this week" is a real answer,
an invented Friday is not.

**Do not invent attendees.** With no diarisation there is often no way to know
who was in the room. Names can sometimes be recovered from how people are
addressed ("Marta, ¿puedes mirarlo?"), and that is fair game. Guessing from
context is not — leave `**Con:**` out rather than fill it with plausible
colleagues.

**Be shorter than what you are summarising.** If the summary approaches the
length of the transcript, it is a transcript with extra steps. The test is
whether somebody who missed the meeting could read it in a minute and know what
they need to do.

**Say when the recording failed you.** Whisper drops audio, mishears numbers and
invents labels during silence. If a decision hinges on a figure you cannot read
confidently, write the figure with the timestamp and flag it rather than
laundering a guess into a clean-looking table.
