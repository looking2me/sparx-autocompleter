# Handoff: Sparx autocompleter

Last updated: 16 Nov 2026

Goal: make this Sparx Maths autocompleter work again. It is for A-Level coursework. The teacher has given permission to experiment. The user approves each step that changes their real account.

Credentials stay in `.env`. Never write them into files, chat or logs.

## Read this first
- The project is under git. `main` holds the starting point from 16 Nov. The work from 16 Nov is on the branch `todo-fixes` and isn't committed yet.
- `TODO.md` has the current status and what's left. `README.md` explains setup and use.
- Run `npm.cmd run check` after any change. It is read-only.
- Don't run `npm.cmd start` → **Submit answers**, or `npm.cmd run cli`, without the user's go-ahead. Both send answers to the real account.

## Account state (16 Nov)
- **18 Nov homework:** 23 of 28 questions done. Tasks 1–6 are complete. Flashcards (1) and Revision (4) are open.
  - 22 of those answers were sent from somewhere outside this conversation, before 16 Nov afternoon.
  - Task 6, question 3 was the one test submission, made with the user's go-ahead. It was marked correct.
- **11 Nov homework:** opened (its questions were generated while testing), 0 of 35 done. The Sparx page still says "Not started".
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
- **Answer:** `ActivityAction` with field 1 = activity ID and field 2 = `{ref, value}` entries. Confirmed working for number fields. The verdict is read by `_parseSubmitResult` (state "1" = correct for every part and field).
- **Logout:** `POST https://api.sparx-learning.com/oauth2/logout` from inside the page, then the browser closes. The access token stays valid until it expires.
- The old `studentapi.api.sparxmaths.uk` code has been removed.

## Entry points
- `server.js`: the web interface (`npm.cmd start`, port 4173). `/api/homeworks` now includes `progress` and `late`.
- `classes/Runner.js`: runs tasks in "preview" (nothing sent) or "run" mode.
- `index.js`: the text-only version (`npm.cmd run cli`).
- `scripts/check.mjs`: the read-only health check (`npm.cmd run check`, add `-- --ai` to include one AI answer).

## Known gaps
See `TODO.md`. The main ones:
- **Flashcards (multiple choice):** not supported. Skipped safely.
- **Card-slot questions and bookwork checks:** not tested yet.
- **Choice-answer submit format:** never tested. A wrong format costs one of the question's 3 attempts.

## Useful facts from captures
- Homework page: `https://maths.sparx-learning.com/student/homework?pkg_type=homework`.
- Question page: `/student/package/<pkg>/task/<task>/item/<n>`.
- On the question page, "Answer" shows the inputs. Typing into them with Puppeteer wasn't reliable, so use the API instead.
- Cookie banner: choose "DECLINE ALL".
- Test question: (x+a)²+b for x²+10x−7 gives a = 5, b = −32.
