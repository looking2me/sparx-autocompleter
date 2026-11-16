# Handoff: Sparx autocompleter

Last updated: 16 Nov 2026

Goal: make this Sparx Maths autocompleter work again. It is for A-Level coursework. The teacher has given permission to experiment. The user approved each live step (login, opening a homework, opening a question, submitting an answer).

Credentials stay in `.env`. Never write them into files, chat or logs.

## Read this first
- The code has changed a lot since the last session. Some of it was written by another session (see "Who changed what" below). Nothing in the new question code has been tested end to end.
- The real Sparx account may already have an attempt started. An attempt on the 18 Nov homework, Task 1, item 1 was opened on the account. A submission for that item may or may not have been sent. Check Sparx in a browser before running anything.
- Do not run the full autocompleter (`npm start` or `npm run cli`) until the user says so. It submits answers to the account.

## Environment
- Node v26, dependencies installed in `node_modules`.
- Puppeteer's bundled Chrome is broken on this machine. Use the installed Google Chrome:
  `PUPPETEER_EXECUTABLE_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"`
- PowerShell blocks `npm.ps1`. Run `npm.cmd start`, not `npm start`.
- The browser is headless by default. Set `SPARX_HEADLESS=false` to watch it.
- Cookie banner on Sparx: choose "DECLINE ALL", the privacy-preserving option.

## Entry points
- `npm start` runs `server.js`, a local web interface (default port 4173, set `SPARX_UI_PORT` to change it). It calls the same classes as the CLI.
- `npm run cli` runs `index.js`, the original command-line flow. It asks "Select number:" after listing homework.

## Current code (`classes/Sparx.js`)

### Verified by test (against the live site)
- **Login** through the school selector and login form (`_loginWithPuppeteer`). The token and session ID are captured.
- **`getHomeworks()`:** calls `ListStudentPackages` and returns 8 homeworks. Names and due dates match the Sparx page. Question counts are set to 0 because the list response doesn't include them.
- **Requests go through the browser** (`_browserGrpc`). Plain Node requests get a Cloudflare 403.
- **Token prefix** must be lowercase `bearer `. `Bearer ` returns an internal error (gRPC 13).
- **Session ID** is copied from the page's own requests, because the page generates its own ID.
- **Task loading** (`_getPackageTasks`, used by `getHomeworkOverview`, `getHomeworkTasks` and `getTaskActivities`). If `GetPackage` has no tasks, it calls `GeneratePackageContents` (same body: field 1 = `packages/<uuid>`), the way the site does when a homework is first opened. Tested on 16 Nov:
  - 11 Nov (unstarted): 8 tasks, 35 items, 0 done. Generated on the first load. The second load only called `GetPackage`. The Sparx page matches and still says "Not started".
  - 18 Nov: 8 tasks, 28 items, 22 done, matching the Sparx page (Tasks 1–5 100%, Task 6 67%).
- **`getActivity`** loads a question (tested on 18 Nov, Task 1, item 1).
- **AI answer** (`Activity.getAnswers`, OpenRouter): one question gave a = 5, b = −32, which is correct.
- **Web interface**: sign in, homework list and task progress work. Not rechecked since the task-loading fix.

### Written but not tested
- `registerActivityStart` sends `ActivityAction` with the activity ID and an empty field 3. This matches the captured start call. Not called by any test yet.
- `submitAnswer` sends `ActivityAction` with field 1 (activity ID) and field 2 (a list of `{ref, value}` entries). **This format is a guess.** The captured start call used field 1 and field 3, and no captured submission exists yet. `_parseSubmitResult` reads the verdict from field 1 → field 4 → field 1 → field 3, with parts in field 7 and results in field 4. Also unverified.
- Bookwork functions (`getTaskBookworkCheck`, `answerTaskBookworkCheck`, `completeTaskBookwork`) use message shapes from the site's protobuf definitions, as the code comment says. Not tested.
- The "completed" rule (an item is done when its progress field is filled in) matched the Sparx page for every task on 18 Nov. It hasn't been seen for an item answered wrongly, so that case is still unchecked.

### Legacy code (not used)
Methods named `_legacy`, `_getHomeworksLegacy`, `_getHomeworkTasksLegacy`, `_getTaskActivitiesLegacy`, `_getActivityLegacy`, `_registerActivityStartLegacy`, `_submitAnswerLegacy`, and `getBookworkCheck`/`sendBookworkCheck`/`completeBookworkCheck` call the old `studentapi.api.sparxmaths.uk` host. They are kept for reference.

## Question flow (captured)
URL: `https://maths.sparx-learning.com/student/package/<pkgUuid>/task/<taskUuid>/item/<n>`

- Homework list: `https://maths.sparx-learning.com/student/homework?pkg_type=homework`. Each homework is an accordion button starting with "Homework due".
- Clicking a homework calls `GeneratePackageContents`. The response has tasks in field 7 (Task 1–6, Flashcards, GCSE Exam Practice Revision). Each task has `packages/<pkg>/tasks/<taskUuid>` in field 1, a name in field 3, and items in field 5 ("Task Item 1", …). Each item has a task type (`LEARNING_TASK_TYPE_CORE` or `_EXTENSION`) and `max_attempts` 3.
- Clicking the first "Start" calls `Activities/GetActivity` and then `Activities/ActivityAction`:
  - `GetActivity` request: field 2 = item path. Response: field 1 = `activities/<uuid>`, field 4 = question JSON (`layout`, parts such as `part/...`).
  - `ActivityAction` on open: field 1 = `activities/<uuid>`, field 3 = "". Probably counts as an attempt.
- Test question: "Express x²+10x−7 in the form (x+a)²+b". Correct answer: a = 5, b = −32.

## Answer entry on the question page (unresolved)
- The "Answer" button shows two inputs (`input[placeholder='Enter number']`) and a "Submit answer" button. Submit stays disabled until both have values.
- `puppeteer.type` and keyboard input did not fill the inputs reliably. One attempt put "-532" in box 1 and left box 2 empty.
- The next idea, not yet run: set each input's value with the native `HTMLInputElement.prototype.value` setter, dispatch `input` and `change` events, then click "Submit answer" with a real click. Check the input values and the button's disabled state before clicking.
- Confirm the answer boxes actually hold the values before any submit. Watch for stray characters.

## Who changed what

Changed by this conversation (verified present):
- `classes/Sparx.js`: browser stays open until logout, lowercase `bearer`, session ID sync, `_browserGrpc`, `getHomeworks` on the new API, headless set by `SPARX_HEADLESS`.
- `HANDOFF.md` and `DISCORD_PROGRESS_TEMPLATE.md` (the template was missing and was recreated).

Changed by something else (timestamps 15–16 Nov, source not confirmed):
- `classes/Sparx.js` (16 Nov 17:51): the question, bookwork and submit functions on the new API, plus `PACKAGES_URL` and `ACTIVITIES_URL`.
- `server.js` (new, 16 Nov 17:46): the web interface server. It signs in to Sparx and uses OpenRouter for AI answers.
- `classes/Runner.js` (new, 16 Nov 17:45): runs tasks and turns answers into readable text.
- `ui/index.html` (new, 16 Nov 17:48): the web interface.
- `package.json` (16 Nov 17:48): `start` runs `server.js`, and `cli` runs `index.js`.
- `README.md` (16 Nov 17:48): not reviewed.
- `.env`, `index.js`, `classes/Activity.js`, `classes/Homework.js` (15 Nov evening): not edited by this conversation.

`.env` contains `OPENROUTER_API_KEY`, `OPENROUTER_TEXT_MODEL` and `OPENROUTER_VISION_MODEL`, besides the Sparx settings. Don't print the values.

## Known problems
- The 18 Nov homework went from 0% (15 Nov) to 22 of 28 done (16 Nov). It isn't known whether this app submitted those answers. Find out before relying on `submitAnswer`.
- Question counts per homework are 0 in the list. They need `getHomeworkOverview()` per homework.
- Logout returns 403 when made as a plain Node request. Move it to `_browserGrpc`, or accept the warning.
- `index.js` has a no-op line (`homework.completedAmountOfQuestions == ... || 0;`). Ignore it.

## Suggested next steps
1. Check Sparx in a browser to see whether the test question was answered.
2. Work through `TODO.md`. Task loading for unstarted homeworks is fixed (16 Nov).
3. Capture a real submission only with the user's go-ahead. Decode the `ActivityAction` request and compare it with `submitAnswer()`.
4. Fix the answer entry on the question page (see above), then test a single answer.
5. Test the bookwork functions only after the answer submission works.
6. Run the full autocompleter only when the user says so.

## Scratch scripts
The test scripts are in the scratchpad folder of the previous session, and may no longer exist. Use the same login pattern each time: `dotenv` from `.env`, the school matched with Fuse against `getSchools()`, `new Sparx(username, password, school)`, `await client.login()`, then `await client.logout()` and `process.exit(0)` in `finally`.
