# Developer notes

How the project works and what is known. For setup and use, see `README.md`. For status and open work, see `TODO.md`.

## Read this first
- This is a coursework project. Only run it against an account you have permission to use.
- Credentials live in `.env` (copy `.env.example`). Never put them in files, logs, issues or screenshots.
- Run `npm run check` after any change. It is read-only.
- **Submit answers** (web interface) and `npm run cli` send real answers to the account. Don't use them for testing without meaning to.
- A wrong answer costs one of the item's attempts (3 by default). Check any new kind of answer by hand before sending it.

## Environment
- Node 18 or later. On Windows PowerShell use `npm.cmd` if `npm` is blocked by the execution policy.
- Puppeteer's bundled Chrome can fail to install. Set `PUPPETEER_EXECUTABLE_PATH` to an installed Chrome. `server.js` and `scripts/check.mjs` pick the usual Windows location automatically.
- The browser is hidden by default. `SPARX_HEADLESS=false` shows it.
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
- **Answer:** `ActivityAction` with field 1 = activity ID and field 2 = `{ref, value}` entries (the site's `Answer.components` map of text to text). The value is a string: a number box sends its text, a text box its trimmed text, a multiple choice its text (or its image ID for a picture choice), and a card in a slot the card's ref. The verdict is read by `_parseSubmitResult` (state "1" = correct for every part and field).
- **Item finished?** An item is finished when its state has status CORRECT (field 1 = 1) and its completed flag (field 2 = 1). Statuses: 2 incorrect, 3 skipped, 4 pending.
- **Flashcards:** an item is a sequence of cards. After a correct answer Sparx serves the next card from `GetActivity` for the same item, and returns the same card again when there are no more. `submitItem` in `Runner.js` loops on that.
- **Bookwork:** `GetBookworkCheck` / `AnswerBookworkCheck`. Code `3C` means question 3 of task 3. The options are the student's own answers across the task, so the right one is the answer to the named question. The position sent is the option's place in the list, counting from 1.
- **Logout:** `POST https://api.sparx-learning.com/oauth2/logout` from inside the page, then the browser closes. The access token stays valid until it expires.
- **Decoding:** the protobuf decoder leaves a nested message made only of printable bytes as a string. `protoGet`, `protoAll` and `protoParts` turn it back into fields. A wrong answer's response needs this.

## Questions (`classes/Activity.js`)
- Question text is found in the "question-text" group, wherever the layout puts it.
- `buildPrompt` handles the common layouts. `buildGenericPrompt` handles any layout with cards, slots, choices, number boxes or text boxes.
- Choices that are pictures are downloaded and sent to the vision model, each labelled with its choice ID.
- `normalizeAnswers` checks the model's answer against the question: it fixes a wrong id on a slot answer, rejects a card used twice, and never sends an answer that doesn't fit.

## Entry points
- `server.js`: the web interface (`npm start`, port 4173 or the next free one). `/api/homeworks` includes `progress` and `late`.
- `classes/Runner.js`: runs tasks in "preview" (nothing sent) or "run" mode. `submitItem` answers one item to the end.
- `index.js`: the text-only version (`npm run cli`).
- `scripts/check.mjs`: the read-only health check (add `-- --ai` to include one AI answer).
- `scripts/test-cards.mjs`: offline tests with a fake Sparx (`npm test`).

## Known gaps
See `TODO.md`. The main ones:
- **After a wrong Flashcards answer:** the card moves to a "learn it" step (activity state 3, `TAL_START`, with an explanation and an "Okay, I've got it" button). Sending an answer in that state is refused with gRPC status 9. The step between a wrong answer and the retry is not implemented. The site's button should show which call moves the card on.
- **Bookwork from the app:** only works for questions answered in the same run. Otherwise the app says to answer it on the site.
- **A bookwork check can sit on a page** and may block the next card until it is answered.

## Useful facts from captures
- Homework page: `https://maths.sparx-learning.com/student/homework?pkg_type=homework`.
- Question page: `/student/package/<pkg>/task/<task>/item/<n>`.
- On the question page, "Answer" shows the inputs. Typing into them with Puppeteer wasn't reliable, so use the API instead.
- Cookie banner: choose "DECLINE ALL".
- Activity states: 1 question, 2 results, 3 learn step start, 4 learn step timer, 5 step result.
