# Handoff: Sparx autocompleter

Last updated: 16 Nov 2026

Goal: make this Sparx Maths autocompleter work again. It is for A-Level coursework. The teacher has given permission to experiment. The user approves each step that changes their real account.

Credentials stay in `.env`. Never write them into files, chat or logs.

## Read this first
- The project is under git. Keep all work on `main`; the user doesn't want other branches. The first commit is the starting point from 16 Nov.
- `TODO.md` has the current status and what's left. `README.md` explains setup and use.
- Run `npm.cmd run check` after any change. It is read-only.
- Don't run `npm.cmd start` → **Submit answers**, or `npm.cmd run cli`, without the user's go-ahead. Both send answers to the real account.

## Account state (16 Nov)
- **18 Nov homework:** 23 of 28 questions done. Tasks 1–6 are complete. Flashcards (1) and Revision (4) are open.
  - 22 of those answers were sent from somewhere outside this conversation, before 16 Nov afternoon.
  - Task 6, question 3 was the one test submission, made with the user's go-ahead. It was marked correct.
- **11 Nov homework:** finished (35 of 35, plus 2 bookwork checks). Sparx lists it as Completed. Answers sent with the user's go-ahead: 3 questions, 4 Flashcards cards, 2 bookwork checks.
- The other 6 homeworks haven't been opened.

## Environment
- Node v26. `npm.cmd` in PowerShell, because `npm.ps1` is blocked.
- Puppeteer's own Chrome is broken on this machine. `server.js` and `scripts/check.mjs` use the installed Chrome automatically. Other scripts need `PUPPETEER_EXECUTABLE_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"`.
- Hidden browser by default. `SPARX_HEADLESS=false` shows it.
- Packages: dotenv, fuse.js, https-proxy-agent, jsbi, puppeteer, rand-user-agent.

## How the code talks to Sparx (`classes/Sparx.js`)
- **Login:** Puppeteer fills in the school selector and the login form. The token and session ID are copied from the page's own requests.
  - The token must be lowercase `bearer `. `Bearer ` gets an internal error (gRPC 13).
  - The session ID must be the page's own one.
- **Requests:** `_browserGrpc(url, bodyBase64)` sends each gRPC-web call from inside the page, because plain Node requests get a Cloudflare 403.
- **Homework list:** `ListStudentPackages`.
- **Tasks:** `_getPackageTasks()` calls `GetPackage`. If there are no tasks, it calls `GeneratePackageContents`, then `GetPackage` again if needed. Pass `{ generate: false }` to only read. `getHomeworkProgress()` uses that, so viewing the list never opens a homework.
- **Question:** `GetActivity` (request field 2 = item path). The question is JSON in response field 4.
- **Start:** `ActivityAction` with field 1 = activity ID and field 3 = "".
- **Answer:** `ActivityAction` with field 1 = activity ID and field 2 = `{ref, value}` entries (the site's `Answer.components` map of text to text). The value is a string: a number box sends its text, a text box its trimmed text, a choice its text, and a card in a slot the card's ref. Confirmed working for all four. The verdict is read by `_parseSubmitResult` (state "1" = correct for every part and field).
- **Item finished?** An item is finished when its state has status CORRECT (field 1 = 1) and its completed flag (field 2 = 1). Statuses: 2 incorrect, 3 skipped, 4 pending. Flashcards items are a sequence of cards: after a correct answer Sparx serves the next card from `GetActivity` for the same item, and returns the same card again when there are no more. `submitItem` in `Runner.js` loops on that.
- **Bookwork:** `GetBookworkCheck` / `AnswerBookworkCheck`. Code `3C` means question 3 of task 3. The options are the student's own answers across the task, so the right one is the answer to the named question. The position sent is the option's place in the list, counting from 1.
- **Logout:** `POST https://api.sparx-learning.com/oauth2/logout` from inside the page, then the browser closes. The access token stays valid until it expires.
- The old `studentapi.api.sparxmaths.uk` code has been removed.

## Entry points
- `server.js`: the web interface (`npm.cmd start`, port 4173). `/api/homeworks` now includes `progress` and `late`.
- `classes/Runner.js`: runs tasks in "preview" (nothing sent) or "run" mode. `submitItem` answers one item to the end (Flashcards are a run of cards).
- `index.js`: the text-only version (`npm.cmd run cli`).
- `scripts/check.mjs`: the read-only health check (`npm.cmd run check`, add `-- --ai` to include one AI answer).
- `scripts/test-cards.mjs`: offline test of the Flashcards loop with a fake Sparx (`npm.cmd test`).

## Known gaps
See `TODO.md`. The main ones:
- **The Flashcards loop has not run live.** It is tested offline only. The first live run is the 18 Nov Flashcards item.
- **Bookwork from the app:** only works for questions answered in the same run. Otherwise the app says to answer it on the site.
- A wrong answer costs one of the item's 3 attempts. Check answers by hand before sending anything new.

## Useful facts from captures
- Homework page: `https://maths.sparx-learning.com/student/homework?pkg_type=homework`.
- Question page: `/student/package/<pkg>/task/<task>/item/<n>`.
- On the question page, "Answer" shows the inputs. Typing into them with Puppeteer wasn't reliable, so use the API instead.
- Cookie banner: choose "DECLINE ALL".
- Test question: (x+a)²+b for x²+10x−7 gives a = 5, b = −32.
