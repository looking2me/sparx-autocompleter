# Sparx Maths Autocompleter

An A-Level coursework project that works through Sparx Maths homework. It signs in with a hidden Chrome window, reads the homework through Sparx's own API, asks an AI model (through OpenRouter) for each answer, and sends the answers.

## What works

Checked against the live site on 16 Nov 2026.

| Feature | Status |
|---|---|
| Sign in and sign out | ✅ Working |
| Homework list with progress and "Late" labels | ✅ Working |
| Opening a homework, including one you haven't opened on Sparx | ✅ Working |
| Answering number questions | ✅ Working (a real answer was sent and marked correct) |
| Multiple-choice questions | ✅ Working (4 real answers marked correct) |
| Card-slot questions (pick a card, put cards in order) | ✅ Working (2 real answers marked correct) |
| Typed answers (text boxes) | ✅ Working (1 real answer marked correct) |
| Flashcards (a run of cards) | ✅ Working in a hand-run test. The app loops through the cards itself, tested offline only (`npm.cmd test`) |
| Bookwork checks | ✅ Working (2 real checks passed, answered by hand with a checked option) |
| Question time spoofing, Times Tables, Sparx Reader, Sparx Science | ⏳ Not done |

## Setup

1. Install [Node.js](https://nodejs.org/en) (v18 or later) and Google Chrome.
2. Fill in `.env` (see below).
3. Install and start. On Windows PowerShell, type `npm.cmd`, not `npm`:

```bash
npm.cmd install
npm.cmd start
```

## Using it

`npm.cmd start` opens a small black-and-white page in your browser. It only listens on your own computer.

1. **Sign in.** This takes about 10 seconds.
2. **Pick a homework.** The list shows how far along each one is.
3. **Tick the tasks** you want.
4. **Preview answers** shows what it would answer and sends nothing. **Submit answers** sends them.

Use **Stop after this question** to stop a run, and **Quit** to close everything.

Other commands:

| Command | What it does |
|---|---|
| `npm.cmd test` | Offline test of the Flashcards card loop with a fake Sparx. No network, no account. |
| `npm.cmd run check` | Read-only health check: signs in, lists homework, reads one homework and one question, signs out. Sends nothing. |
| `npm.cmd run check -- --ai` | Same, plus asks the AI for one answer (not sent). Uses a little OpenRouter credit. |
| `npm.cmd run cli` | The older text-only version. **It sends answers** as soon as you pick a homework. |

## Settings (.env)

```env
# Required
SPARX_SCHOOL="Your School Name"   # Partial names work
SPARX_USERNAME="yourUsername"
SPARX_PASSWORD="yourPassword"

# Required for answering (OpenRouter)
OPENROUTER_API_KEY="..."
OPENROUTER_TEXT_MODEL="..."       # Model ID for text-only questions
OPENROUTER_VISION_MODEL="..."     # Model ID for questions with a picture

# Optional
# OPENROUTER_REASONING_EFFORT="medium"   # low, medium or high
# SPARX_HEADLESS="false"                 # Show the Chrome window while it works
# SPARX_UI_PORT="4173"                   # Port for the page
# PUPPETEER_EXECUTABLE_PATH="..."        # Chrome location, if not the usual Windows one
# DATAIMPULSE_API_URL=""                 # Residential proxy
```

Never share `.env`. It holds your password and API key. Git is set to ignore it.

## How it talks to Sparx

- Sparx moved to `api.sparx-learning.com`. The old `studentapi.api.sparxmaths.uk` address is no longer used.
- Plain requests get blocked by Cloudflare, so every request is sent from inside the signed-in (hidden) Chrome tab.
- The site sends its token as lowercase `bearer`, and makes its own session ID. The app copies both.
- A homework's questions only exist after it has been opened once. The app opens it the same way the site does (`GeneratePackageContents`), which doesn't start or answer anything.

## Troubleshooting

- **PowerShell says "running scripts is disabled"**: type `npm.cmd` instead of `npm`.
- **"Could not find Chrome"**: install Google Chrome, or set `PUPPETEER_EXECUTABLE_PATH` in `.env`.
- **"No matching school found"**: try a shorter part of your school's name.
- **Sign-in fails**: wait a few seconds and try again. Check the username and password in `.env`.
- **Something stopped working**: run `npm.cmd run check` to see which part failed.
