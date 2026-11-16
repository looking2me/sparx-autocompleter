# Sparx autocompleter: to-do list

Checked on 16 Nov 2026 against the live site. All checks were read-only: nothing was started or submitted.

## Current functionality

| Part | Status | Notes |
|---|---|---|
| Login (headless Chrome) | ✅ Works | About 9 seconds |
| Homework list | ✅ Works | 8 homeworks, names and due dates correct |
| Tasks for a started homework | ✅ Works | 18 Nov: 8 tasks, 28 items. Done counts match the Sparx page exactly (22 of 28) |
| Tasks for an unstarted homework | ✅ Works (fixed 16 Nov) | 11 Nov: 8 tasks, 35 items, matching the Sparx page. The page still says "Not started" afterwards |
| Loading a question | ✅ Works | Question text and answer fields read correctly |
| AI answer (one question) | ✅ Works | Got a = 5, b = −32, which is correct, in 2 seconds |
| Bookwork check (read) | ✅ Works | A completed task returns "already exists", which the code treats as no check |
| Web interface | ✅ Works | Sign in, homework list and task progress all work. It uses the same task loading as above, but hasn't been rechecked in the interface since the fix |
| Submitting answers | ❓ Not verified by a test | The 18 Nov homework went from 0% to 22 of 28 done since 15 Nov. Something submitted those answers, but it isn't known whether it was this code |
| Logout | ⚠️ Partly works | Returns 403, so the Sparx session may stay open until it expires |
| CLI (`npm run cli`) | ⚠️ Not run | Has garbled ✓/× symbols, and the final percentage will show NaN |

## To do

### 1. Must fix (blocks normal use)

- [x] **Load tasks for unstarted homeworks.** Done on 16 Nov.
  `_getPackageTasks()` in `classes/Sparx.js` now calls `Packages/GeneratePackageContents` when `GetPackage` has no tasks, the same as the site does when a homework is first opened. If that returns no tasks either (it was already generated), it reads `GetPackage` again.
  - Tested offline (4 cases) and live on the 11 Nov homework: 8 tasks, 35 items, 0 done. The second load only called `GetPackage`. The Sparx page shows the same tasks and still says "Not started".
  - Still to check: the 11 Nov homework in the web interface.

- [ ] **Confirm that answer submission works.**
  The `submitAnswer()` request format was written without a captured submission.
  - First: find out how the 22 completed items on the 18 Nov homework were done (the app's "Submit answers", the CLI, or by hand).
  - If the app did them, submission works. Note it in `HANDOFF.md`.
  - If not, test one submission on one question, with the user's go-ahead. Check that the result matches the Sparx page.

- [ ] **Add the two missing dependencies to `package.json`.**
  `http-proxy-agent` and `https-proxy-agent` are imported in `classes/Sparx.js` but not listed. They only work because another package installs them. A clean `npm install` could break the app.
  - Run: `npm.cmd install http-proxy-agent https-proxy-agent`

### 2. Should fix

- [ ] **Show a message when a homework has no tasks in the web interface**, instead of "0 of 0 questions done". This should be rare now, but it can still happen if loading fails. For example: "Couldn't load this homework's tasks. Try again."
- [ ] **Show progress in the homework list.** The list only shows names and dates. Add done/total and a "Late" label, like the Sparx page. The counts need `getHomeworkOverview()` per homework, so load them lazily.
- [ ] **Fix logout.** It is a plain Node request, so Cloudflare blocks it with 403. Send it through `_browserGrpc()`, or find the logout call the site makes and copy it.
- [ ] **Preview the Flashcards and Revision tasks before running them.** They are different question types from Topic Practice and haven't been tested. Use "Preview answers" only. It doesn't submit anything.
- [ ] **Fix the CLI (`index.js`):**
  - Lines 189 and 219 (and the matching × lines) print garbled symbols (`âœ“`). Re-save the file as UTF-8 and retype ✓ and ×.
  - The question totals are 0, so the final "old% -> new%" line shows NaN. Use the counts from `getHomeworkOverview()`.
  - Remove the no-op line `homework.completedAmountOfQuestions == ... || 0;`.

### 3. Tidy up

- [ ] **Put the project under git** (local only), so every change from every session can be seen and undone. Add `.env`, `bookwork/` and `node_modules/` to `.gitignore` first (check the current `.gitignore`).
- [ ] **Remove unused dependencies:** `@google/generative-ai`, `@lem0-packages/puppeteer-page-proxy`, `discord.js` and `jsdom` aren't imported anywhere.
- [ ] **Remove the legacy methods** (`_…Legacy`, `getBookworkCheck`, `sendBookworkCheck`, `completeBookworkCheck`, `registerBookworkCheckStart`), once the new ones are confirmed. They call the old `studentapi` host.
- [ ] **Fix the garbled comment characters** in `classes/Activity.js` (lines 247–258). This is cosmetic only.
- [ ] **Add a read-only check script** to the project (for example `npm run check`). It would log in, list homework, read one homework's tasks and one question, then log out. Use it after every change.
- [ ] **Update the README.** Cover `npm.cmd start` (web interface) and `npm run cli`, the Chrome path, `SPARX_HEADLESS`, `SPARX_UI_PORT` and the OpenRouter settings in `.env`.
- [ ] **Keep `HANDOFF.md` up to date.** It doesn't yet say that the 18 Nov homework is now 22 of 28 done.

### Minor notes
- The web interface's Quit button uses a browser confirm dialog. It works in a normal browser, but embedded browsers that block dialogs ignore it.
- The site sends a lowercase `bearer` token and its own session ID. Keep both fixes if `Sparx.js` is rewritten.
