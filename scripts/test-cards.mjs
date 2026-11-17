// Offline test of the Flashcards card loop (submitItem) with a fake Sparx client: no network, no account.
//   npm.cmd test
import { submitItem } from "../classes/Runner.js";
import { Sparx } from "../classes/Sparx.js";
import { encodeProto, TYPES } from "../classes/Protobuf.js";

let failures = 0;
const check = (name, ok, detail) => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail ?? ""}`); };

// A fake item made of `n` cards. wrongAt: card number marked wrong. unsolvable: card number getAnswers() returns null for.
function fakeItem({ n, wrongAt = 0, unsolvable = 0, laggingCompleted = false }) {
    const log = { starts: 0, submits: [], loads: 0 };
    let shown = 1;
    const card = (k) => ({
        id: `card-${k}`,
        registerStart: async () => { log.starts++; },
        submitAnswers: async (_hw, answers) => { log.submits.push({ card: k, answers }); return k !== wrongAt; },
        getAnswers: async () => (k === unsolvable ? null : { REF: `answer-${k}` }),
    });
    const client = {
        // finished once the last card was answered (unless the flag lags behind)
        getTaskActivities: async () => [{ activityIndex: 1, completed: !laggingCompleted && log.submits.length >= n && log.submits.at(-1).card === n }],
        getActivity: async () => { log.loads++; shown = Math.min(n, log.submits.length + 1); return card(laggingCompleted ? log.submits.at(-1).card : shown); },
    };
    return { client, log, first: card(1) };
}

const run = async (opts, extra = {}) => {
    const { client, log, first } = fakeItem(opts);
    const result = await submitItem({ client, homeworkId: "h", taskId: "t", index: 1, activity: first, answers: { REF: "answer-1" }, pauseMs: 0, ...extra });
    return { result, log };
};

{ // 1. an ordinary single question
    const { result, log } = await run({ n: 1 });
    check("single question", result.correct && result.cards === 1 && !result.unfinished && log.loads === 0, JSON.stringify(result));
}
{ // 2. four flashcards in a row
    const { result, log } = await run({ n: 4 });
    check("4 cards answered in order", result.correct && result.cards === 4 && !result.unfinished && log.submits.map(s => s.card).join() === "1,2,3,4", `submitted cards ${log.submits.map(s => s.card)}`);
    check("each card was started once", log.starts === 4, `starts ${log.starts}`);
}
{ // 3. card 2 is marked wrong: stop there
    const { result, log } = await run({ n: 4, wrongAt: 2 });
    check("stops at the first wrong card", !result.correct && result.cards === 2 && log.submits.length === 2, JSON.stringify(result));
}
{ // 4. card 3 cannot be solved: stop, mark unfinished, send nothing for it
    const { result, log } = await run({ n: 4, unsolvable: 3 });
    check("unsolvable next card leaves the item unfinished", result.correct && result.unfinished && result.cards === 2 && log.submits.length === 2, JSON.stringify(result));
}
{ // 5. the completed flag lags and the same card comes back: do not answer it twice
    const { result, log } = await run({ n: 4, laggingCompleted: true });
    check("same card again is not answered twice", result.correct && result.unfinished && log.submits.length === 1, JSON.stringify(result));
}
{ // 6. safety limit
    const { result, log } = await run({ n: 50 }, { maxCards: 3 });
    check("safety limit", result.correct && result.unfinished && result.cards === 3 && log.submits.length === 3, JSON.stringify(result));
}


{ // 7. a wrong answer's response has small printable messages that the decoder leaves as text: must read as 'not correct', not crash
    const client = Object.create(Sparx.prototype);
    const frame = (fields) => client._grpcFrame(encodeProto(fields));
    const printable = frame([{ index: 1, type: TYPES.LENDELIM, value: [{ index: 4, type: TYPES.LENDELIM, value: 'plain text here' }] }]);
    const empty = frame([]);
    let out;
    try { out = [client._parseSubmitResult(printable), client._parseSubmitResult(empty)]; } catch (e) { out = e.message; }
    check('wrong-answer response is read, not a crash', Array.isArray(out) && out.every(r => r.correct === false), typeof out === 'string' ? out : JSON.stringify(out.map(r => r.correct)));
}

console.log(failures === 0 ? "\nAll tests passed." : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
