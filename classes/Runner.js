const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Text without the site's $...$ markup. */
const plain = (text) => String(text ?? '').replace(/\$/g, '').replace(/\s+/g, ' ').trim();

/**
 * Describe an answer map in words for the interface: "a = 5, b = -32", "5h^9 / 2y^2" or the choice text.
 * Falls back to the plain values if the layout is not recognised.
 */
export function describeAnswers(answers, layoutInfo) {
    const input = layoutInfo?.input || {};
    const pieces = [];

    const walk = (node, previousText) => {
        if (Array.isArray(node)) {
            let last = previousText;
            for (const child of node) {
                if (child?.element === 'text') last = plain(child.text).replace(/=$/, '').trim();
                walk(child, last);
            }
            return;
        }

        if (!node || typeof node !== 'object') return;

        if (node.element === 'number-field' && node.ref in answers) {
            pieces.push({ kind: 'number', text: `${previousText ? previousText + ' = ' : ''}${answers[node.ref]}` });
        } else if (node.element === 'slot' && node.ref in answers) {
            pieces.push({ kind: 'slot', text: plain(input.cards?.[answers[node.ref]]?.content?.[0]?.text) });
        } else if (node.content) {
            walk(node.content, previousText);
        }
    };

    walk(layoutInfo?.layout?.content, '');

    const slots = pieces.filter((piece) => piece.kind === 'slot').map((piece) => piece.text);
    const rest = pieces.filter((piece) => piece.kind === 'number').map((piece) => piece.text);
    const parts = [...rest];
    if (slots.length > 0) parts.push(slots.join(' / '));

    for (const ref of Object.keys(input.choices || {})) {
        if (ref in answers) parts.push(plain(answers[ref]));
    }

    return parts.length > 0 ? parts.join(', ') : Object.values(answers).map(plain).join(', ');
}

/**
 * Answer one item all the way to the end.
 *
 * Most items are a single question. Flashcards items are a sequence of cards: after a correct answer Sparx
 * serves the next card, and the item is only finished when its state says so (see Sparx's completion rule).
 * So after every correct answer this checks the item, and if it is not finished loads the next card and
 * answers that too. It stops at the first card that is not marked correct, at a card it cannot solve, when the
 * same card comes back (Sparx's way of saying there are no more), or after maxCards.
 *
 * Starting and submitting are real actions on the account, as before.
 *
 * @param {object} options
 * @param {object} options.client - A logged-in Sparx client
 * @param {string} options.homeworkId - The package UUID
 * @param {string} options.taskId - The task UUID
 * @param {number} options.index - The item number, starting at 1
 * @param {object} options.activity - The first card, from client.getActivity()
 * @param {object} options.answers - The answers for that first card
 * @param {number} [options.maxCards] - Safety limit on the number of cards
 * @param {number} [options.pauseMs] - Pause between cards
 * @param {(info: {card: number, correct: boolean, answers: object}) => void} [options.onCard]
 * @returns {Promise<{correct: boolean, cards: number, unfinished?: boolean}>}
 *   correct: every card answered was marked correct. unfinished: it stopped before the item was finished.
 */
export async function submitItem({ client, homeworkId, taskId, index, activity, answers, maxCards = 12, pauseMs = 800, onCard = () => {} }) {
    let cards = 0;
    let current = activity;
    let currentAnswers = answers;

    while (true) {
        cards++;
        await current.registerStart();
        const correct = await current.submitAnswers({ id: homeworkId }, currentAnswers, '');
        onCard({ card: cards, correct, answers: currentAnswers });
        if (!correct) return { correct: false, cards };

        const items = await client.getTaskActivities(homeworkId, taskId);
        if (items.find((entry) => entry.activityIndex === index)?.completed) return { correct: true, cards };
        if (cards >= maxCards) return { correct: true, cards, unfinished: true };

        await sleep(pauseMs);
        const next = await client.getActivity(homeworkId, taskId, index);
        if (next.id === current.id) return { correct: true, cards, unfinished: true };

        const nextAnswers = await next.getAnswers();
        if (!nextAnswers) return { correct: true, cards, unfinished: true };

        current = next;
        currentAnswers = nextAnswers;
    }
}

/**
 * Work through the chosen tasks of one homework.
 *
 *  - mode "preview": solve each open question and report the answer. Nothing is started or submitted.
 *  - mode "run": solve, register the start, submit, then answer the task's bookwork check.
 *
 * Progress is reported through emit(event). A question that cannot be solved, or is not marked correct,
 * is left alone (never retried) and the run carries on. Anything that goes wrong while starting or
 * submitting stops the whole run, because the state of that question is then uncertain.
 *
 * @param {object} options
 * @param {object} options.client - A logged-in Sparx client
 * @param {string} options.homeworkId - The package UUID
 * @param {string[]} options.taskIds - The task UUIDs to work on
 * @param {'preview'|'run'} [options.mode]
 * @param {(event: object) => void} options.emit
 * @param {() => boolean} [options.isStopped] - Checked between questions
 * @param {number} [options.pauseMs] - Pause between questions
 */
export async function runTasks({ client, homeworkId, taskIds, mode = 'run', emit, isStopped = () => false, pauseMs = 600 }) {
    const summary = { correct: 0, wrong: 0, skipped: 0, error: 0, done: 0, previewed: 0 };

    emit({ type: 'run', status: 'started', mode });

    try {
        const overview = await client.getHomeworkOverview(homeworkId);
        const chosen = overview.filter((task) => taskIds.includes(task.taskId));

        for (const task of chosen) {
            const history = [];
            const base = { task: task.name, taskId: task.taskId };

            for (const item of task.items) {
                if (isStopped()) {
                    emit({ type: 'run', status: 'stopped', mode, summary });
                    return summary;
                }

                const where = { ...base, index: item.index };

                if (item.completed) {
                    summary.done++;
                    emit({ type: 'item', ...where, status: 'done' });
                    continue;
                }

                emit({ type: 'item', ...where, status: 'solving' });

                let activity;
                let answers;
                try {
                    activity = await client.getActivity(homeworkId, task.taskId, item.index);
                    answers = await activity.getAnswers();
                } catch (error) {
                    summary.error++;
                    emit({ type: 'item', ...where, status: 'error', detail: error.message });
                    await sleep(pauseMs);
                    continue;
                }

                if (!answers) {
                    summary.skipped++;
                    emit({ type: 'item', ...where, status: 'skipped', detail: "Couldn't solve this one, so it was left alone." });
                    await sleep(pauseMs);
                    continue;
                }

                if (mode === 'preview') {
                    summary.previewed++;
                    emit({ type: 'item', ...where, status: 'preview', detail: describeAnswers(answers, activity.layout[0]) });
                    await sleep(pauseMs);
                    continue;
                }

                let result;
                try {
                    emit({ type: 'item', ...where, status: 'submitting' });
                    result = await submitItem({ client, homeworkId, taskId: task.taskId, index: item.index, activity, answers, pauseMs });
                } catch (error) {
                    summary.error++;
                    emit({ type: 'item', ...where, status: 'error', detail: error.message });
                    emit({ type: 'run', status: 'error', mode, summary, message: `Stopped: ${error.message}` });
                    return summary;
                }

                const cardsNote = result.cards > 1 ? ` (${result.cards} cards)` : '';

                if (result.correct && result.unfinished) {
                    // Some cards were answered, but the item is not finished: leave the rest for the student
                    summary.skipped++;
                    emit({ type: 'item', ...where, status: 'skipped', detail: `Answered ${result.cards} card${result.cards === 1 ? '' : 's'}. The next card could not be solved, so the rest is left for you.` });
                } else if (result.correct) {
                    summary.correct++;
                    history.push({ itemIndex: item.index, answers, layout: activity.layout[0] });
                    emit({ type: 'item', ...where, status: 'correct', detail: describeAnswers(answers, activity.layout[0]) + cardsNote });
                } else {
                    summary.wrong++;
                    emit({ type: 'item', ...where, status: 'wrong', detail: result.cards > 1 ? `Card ${result.cards} was not marked correct. Left as it is.` : 'Not marked correct. Left as it is.' });
                }

                await sleep(pauseMs);
            }

            if (mode === 'run' && !isStopped()) {
                try {
                    const bookwork = await client.completeTaskBookwork(homeworkId, task.taskId, history);
                    if (bookwork.status !== 'none') {
                        emit({ type: 'bookwork', ...base, status: bookwork.status, code: bookwork.code, message: bookwork.message });
                    }
                } catch (error) {
                    emit({ type: 'bookwork', ...base, status: 'error', message: error.message });
                }
            }
        }

        emit({ type: 'run', status: 'finished', mode, summary });
    } catch (error) {
        summary.error++;
        emit({ type: 'run', status: 'error', mode, summary, message: error.message });
    }

    return summary;
}
