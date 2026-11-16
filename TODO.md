# Sparx autocompleter: to-do list

Last updated: 16 Nov 2026. All changes are committed on `main`, the only branch. The first commit is the starting point.

## Current functionality

| Part | Status | Notes |
|---|---|---|
| Login | ✅ Works | About 9 seconds, hidden Chrome |
| Logout | ✅ Works | Fixed 16 Nov. The Sparx session goes from signed in (200) to signed out (401) |
| Homework list | ✅ Works | 8 homeworks, with progress ("23/28 questions done", "Not started") and "Late" labels |
| Tasks for any homework | ✅ Works | Unopened homeworks are opened the way the site does it. 11 Nov: 8 tasks, 35 questions |
| Number questions | ✅ Works | One real answer sent (18 Nov, Task 6, question 3), marked correct, and shown as complete on Sparx |
| AI answers | ✅ Works | 6 of 6 number answers checked by hand were right |
| Multiple choice (Flashcards) | ❌ Not supported | Skipped safely, so nothing wrong is sent |
| Card-slot questions | ⚠️ Not tested | |
| Bookwork checks | ⚠️ Not tested | A finished task correctly reports "no check" |
| Web interface | ✅ Works | Checked in the browser, including at phone width |
| Text-only version (CLI) | ✅ Fixed, partly tested | Symbols, progress and percentages fixed. Not run end to end, because it sends answers |
| Health check | ✅ New | `npm.cmd run check`, read-only |

## Done on 16 Nov
- [x] Load tasks for homeworks never opened on Sparx
- [x] Confirm answer sending works (one checked answer, marked correct)
- [x] Preview Flashcards and Revision answers (Revision 4/4 right, Flashcards unsupported)
- [x] Add missing packages, then remove all unused ones (12 → 6)
- [x] Fix logout
- [x] Progress and "Late" labels in the homework list. A message when a homework's tasks can't be loaded
- [x] Fix the text-only version: symbols, progress, NaN percentage, a line that did nothing
- [x] Remove the old API code (about 810 lines) and the garbled comments
- [x] Add the read-only check script
- [x] Turn on git
- [x] Update the README

## Still to do

### Should do
- [ ] **Support Flashcards (multiple choice).**
  - The question text is read from a fixed position (`layout.content[0].content[0].content[0].text`) that doesn't exist in this layout. Find the `question-text` group instead.
  - `buildPrompt` only looks for answers at the top level of the layout. Here the choices sit inside a `part-group`.
  - The submit format for choices has never been tested. A wrong format uses up one of the question's 3 attempts, so test it on one question with the user's go-ahead first.
- [ ] **Test card-slot questions** with Preview, then one real answer.
- [ ] **Test the bookwork check** after finishing a task (the code reads the code and picks the matching answer).

### Nice to have
- [ ] Tidy how some answers are shown in Preview: sequence answers come out as "a) 1, \ 4, … = 23, , = 37".
- [ ] Port question time spoofing to the new API.

## Notes
- The browser pane in this app can't show the page's Quit confirmation. In a normal browser, Quit works fine.
- Keep the lowercase `bearer` token and the session ID copying if `Sparx.js` is ever rewritten.
