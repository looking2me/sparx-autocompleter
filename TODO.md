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
| Multiple choice | ✅ Works | 11 Nov Flashcards: 4 real answers marked correct |
| Card-slot questions | ✅ Works | 11 Nov: a card pick (Task 3) and an ordering question (Task 6), both marked correct |
| Typed answers | ✅ Works | 11 Nov Flashcards card 1, marked correct |
| Flashcards (a run of cards) | ✅ Loop built | Hand-run on 11 Nov. The app now loops through the cards itself. Offline tests pass (`npm.cmd test`). Not yet run live end to end |
| Bookwork checks | ✅ Works | 11 Nov: Task 3 (`3C`) and Task 6 (`6C`) passed. Picked by hand after checking the option text |
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
- [x] Support ordering, card-pick, multiple-choice and typed questions. Found the answer formats in the site's own code
- [x] Finish the 11 Nov homework: 3 questions, 4 Flashcards cards, 2 bookwork checks. It now shows as Completed on Sparx
- [x] Flashcards loop: answer cards until the item is finished. Uses the site's own completion rule (status CORRECT and completed flag)

## Still to do

### Should do
- [ ] **Run the Flashcards loop live.** It is only tested offline. The 18 Nov homework has a Flashcards item not yet started. Run it through the web interface or CLI, with the user's go-ahead, and check the Sparx page shows it complete.
- [ ] **Answer bookwork checks from the app.** `completeTaskBookwork` only works for questions answered in the same run (it needs the answers). Here two checks had to be answered by hand. Fix: when a check names a question this run didn't answer, solve that question (it is already complete) and match the options to the AI answer, only if exactly one option matches.
- [ ] **Typed answers: check the wording Sparx accepts.** `inverse function` was accepted. Other typed cards may want other forms.

### Nice to have
- [ ] Tidy how some answers are shown in Preview: sequence answers come out as "a) 1, \ 4, … = 23, , = 37".
- [ ] Port question time spoofing to the new API.

## Notes
- The browser pane in this app can't show the page's Quit confirmation. In a normal browser, Quit works fine.
- Keep the lowercase `bearer` token and the session ID copying if `Sparx.js` is ever rewritten.
