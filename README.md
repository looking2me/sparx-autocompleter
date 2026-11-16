# Sparx Maths Autocompleter

A Sparx Maths autocompleter using pure HTTP requests and no browser automation.

## Features

| Feature                 | Status |
|-------------------------|--------|
| Answer Questions (number boxes, card slots, multiple choice) | ✅ |
| Bookwork Checks         | ✅     |
| Question Time Spoofing  | ⏳ (not ported to the new API) |
| Times Tables            | ⏳     |
| Sparx Reader            | ⏳     |
| Sparx Science           | ⏳     |

## Installation

1. Install [Node.js](https://nodejs.org/en) (v18 or later recommended)
2. Fill in your credentials in `.env`

```bash
npm install
npm start
```

`npm start` opens a small black and white interface in your browser (it only listens on your own computer).
Sign in, pick a homework, tick the tasks you want, then **Preview answers** (shows the answers, submits nothing) or **Submit answers**.
Use **Stop after this question** to stop a run, and **Quit** to close everything.

The old terminal version is still there: `npm run cli`.
On Windows PowerShell use `npm.cmd` instead of `npm` if scripts are blocked.

## Configuration (.env)

```env
# Required
SPARX_SCHOOL="Your School Name"   # Fuzzy-matched — partial names work
SPARX_USERNAME="yourUsername"
SPARX_PASSWORD="yourPassword"

# Required for AI-powered answer solving (OpenRouter)
OPENROUTER_API_KEY="..."
OPENROUTER_TEXT_MODEL="..."       # OpenRouter model ID for text-only questions
OPENROUTER_VISION_MODEL="..."     # OpenRouter model ID for questions with an image

# Optional — residential proxy (helps avoid rate limits)
# DATAIMPULSE_API_URL=""
```

## URL Changes (April 2025 update)

Sparx migrated parts of their infrastructure. The following URLs were updated:

| Component | Old URL | New URL |
|-----------|---------|---------|
| Student dashboard | `www.sparxmaths.uk/student/?s={slug}` | `{slug}.sparxmaths.uk/student/` |
| OAuth origin header | `auth.sparxmaths.uk` | `{slug}.sparxmaths.uk` |
| School list | `static.sparxhomework.uk/sl/spx001/data.txt` | Same (+ fallback to `selectschool.sparxmaths.uk` added) |

The gRPC-web API at `studentapi.api.sparxmaths.uk` remains unchanged.

## Troubleshooting

- **`Failed to login due to unexpected error`** — Wait a few seconds and retry.
- **`No matching school found`** — Try a shorter or different part of your school's name.
- **`Failed to get OAuth request URL`** — The student URL may have changed again. The slug used in the URL can be confirmed by logging in manually and checking `https://{slug}.sparxmaths.uk/student/` in your browser address bar.
