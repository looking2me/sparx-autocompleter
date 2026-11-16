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

                let correct;
                try {
                    await activity.registerStart();
                    emit({ type: 'item', ...where, status: 'submitting' });
                    correct = await activity.submitAnswers({ id: homeworkId }, answers, '');
                } catch (error) {
                    summary.error++;
                    emit({ type: 'item', ...where, status: 'error', detail: error.message });
                    emit({ type: 'run', status: 'error', mode, summary, message: `Stopped: ${error.message}` });
                    return summary;
                }

                if (correct) {
                    summary.correct++;
                    history.push({ itemIndex: item.index, answers, layout: activity.layout[0] });
                    emit({ type: 'item', ...where, status: 'correct', detail: describeAnswers(answers, activity.layout[0]) });
                } else {
                    summary.wrong++;
                    emit({ type: 'item', ...where, status: 'wrong', detail: 'Not marked correct. Left as it is.' });
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
