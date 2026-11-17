# To-do list

## Status

| Part | Status | Notes |
|---|---|---|
| Login and logout | ✅ Works | About 10 seconds to sign in, hidden Chrome |
| Homework list | ✅ Works | Progress and "Late" labels, read-only |
| Tasks for any homework | ✅ Works | Unopened homeworks are opened the way the site does it |
| Number questions | ✅ Works | Tested live |
| Multiple choice, card slots, ordering, typed answers | ✅ Works | Tested live. Answer formats come from the site's own code |
| Picture choices | ✅ Built | Pictures are sent to the vision model. The model picked the right option in a preview |
| Flashcards (a run of cards) | ⚠️ Partly | The loop is tested offline. A card after a wrong answer is not handled (see below) |
| Bookwork checks | ⚠️ Partly | Work when the question was answered in the same run. Otherwise answer them on the site |
| Web interface | ✅ Works | Glass design, animations, light and dark theme, phone layout |
| Text-only version (`npm run cli`) | ⚠️ Partly | Not run end to end, because it sends answers |
| Health check and tests | ✅ | `npm run check` (read-only), `npm test` (offline) |

## Still to do

### Should do
- [ ] **Handle the step after a wrong Flashcards answer.** The card moves to a learn step (state 3) and refuses answers (gRPC 9) until it is acknowledged. Find the call the site's "Okay, I've got it" button makes, then continue to the retry. A bookwork check shown on the same page may also need answering first.
- [ ] **Run the Flashcards loop live** from the app on an unstarted Flashcards item, and check Sparx shows it complete.
- [ ] **Answer bookwork checks from the app.** `completeTaskBookwork` needs the answers from the same run. Fix: when a check names a question this run didn't answer, solve that question and match the options to the AI answer, only if exactly one option matches.
- [ ] **Typed answers: check the wording Sparx accepts.** Some cards may want other forms of a term.

### Nice to have
- [ ] Tidy how some answers are shown in Preview: sequence answers come out as "a) 1, \ 4, … = 23, , = 37".
- [ ] Port question time spoofing to the new API.
- [ ] Run `npm test` in CI.

## Notes
- Keep the lowercase `bearer` token and the session ID copying if `Sparx.js` is ever rewritten.
- The web interface starts in calm mode if the browser asks for reduced motion. The Motion switch turns the animation back on.
