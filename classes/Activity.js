import { Sparx } from "./Sparx.js";

/** Class representing an Activity. */
class Activity {
    /**
     * Create an Activity.
     * 
     * @param {Sparx} sparxClient - The Sparx client
     * @param {number} taskIndex - The index of the task
     * @param {number} activityIndex - The index of the activity
     * @param {string} id - The ID of the activity
     * @param {string} code - The code of the activity
     * @param {object} layout - The layout of the activity
     */
    constructor(
        sparxClient,
        taskIndex,
        activityIndex,
        id,
        code,
        layout
    ) {
        this.client = sparxClient;
        this.taskIndex = taskIndex;
        this.activityIndex = activityIndex;
        this.id = id;
        this.code = code;
        this.layout = layout;
    }

    async registerStart() {
        return this.client.registerActivityStart(this.id);
    }

    /** Image downloader that goes through the logged-in browser when one is open (plain requests get a 403). */
    _imageDownloader() {
        return this.client?.browser ? (url) => this.client.downloadImage(url) : undefined;
    }

    async getAnswers() {
        // if (this.layout[0].layout.type.includes("multiple-choice") || this.layout[0].layout.type.includes("multi-part")) {
        //     // This quesion is a multiple choice question
        //     const answers = calculateMultipleChoiceAnswer(this.layout[0]);
        //     if (answers) {
        //         return answers;
        //     }
        // }

        const question = questionTextOf(this.layout[0]);
        const imageUrl = questionImageUrl(this.layout[0]);

        const numberFieldIds = Object.keys(this.layout[0].input.number_fields);

        const results = await getAnswerFromAI(question, this.layout[0], numberFieldIds.length, imageUrl, this._imageDownloader());
        return this._normalize(results);
    }

    /**
     * Turn the model's answers into the map the site submits (number field ref -> text,
     * slot ref -> card ref, choice ref -> choice text). Returns undefined, with a warning,
     * if the answers do not fit the question, so nothing wrong gets submitted.
     */
    _normalize(results) {
        if (!results || results.length === 0) return;

        const { answers, problems } = normalizeAnswers(results, this.layout[0]);
        if (problems.length > 0) {
            console.warn(`[WARN] Not using the model's answer (${problems.join('; ')}).`);
            return;
        }

        return answers;
    }

    async getDumbAnswers() {
        const question = questionTextOf(this.layout[0]);
        const imageUrl = questionImageUrl(this.layout[0]);

        const results = await getDumbAnswerFromAI(question, this.layout[0], imageUrl, this._imageDownloader());
        return this._normalize(results);
    }

    async submitAnswers(homework, answers, bookworkCode) {
        return this.client.submitAnswer(homework, this.id, answers, bookworkCode);
    }
}

const hasType = (node, name) => Array.isArray(node?.type) && node.type.includes(name);

/**
 * The question's text, wherever the layout keeps it. Most layouts have it at the same fixed spot, but
 * Flashcards (multi-part, interleaved-question-answer) wrap it in a part-group, so look for the
 * "question-text" group instead. Falls back to the old fixed spot.
 */
function questionTextOf(layoutInfo) {
    const found = [];
    const walk = (node) => {
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (!node || typeof node !== 'object') return;
        if (node.element === 'group' && hasType(node, 'question-text')) {
            const parts = [];
            const collect = (n) => {
                if (Array.isArray(n)) n.forEach(collect);
                else if (n && typeof n === 'object') { if (n.element === 'text' && n.text) parts.push(n.text); if (n.content) collect(n.content); }
            };
            collect(node.content);
            if (parts.length) found.push(parts.join(' '));
            return;
        }
        if (node.content) walk(node.content);
    };
    walk(layoutInfo.layout?.content);

    if (found.length) return found.join('\n\n');
    return layoutInfo.layout?.content?.[0]?.content?.[0]?.content?.[0]?.text;
}

/** The URL of the picture in the question, if it has one. */
function questionImageUrl(layoutInfo) {
    let image = null;
    const walk = (node) => {
        if (image) return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (!node || typeof node !== 'object') return;
        if (hasType(node, 'question-image') && node.figure?.image) { image = node.figure.image; return; }
        if (node.content) walk(node.content);
    };
    walk(layoutInfo.layout?.content);
    return image ? 'https://assets.sparxhomework.uk/' + image : undefined;
}

/** All slot elements (reading order) in a layout. */
function findSlots(node, out = []) {
    if (Array.isArray(node)) {
        node.forEach(n => findSlots(n, out));
    } else if (node && typeof node === 'object') {
        if (node.element === 'slot') out.push({ ref: node.ref, accept: node.accept });
        if (node.content) findSlots(node.content, out);
    }

    return out;
}

/** The value the site sends for a choice: its text, or the image source for a picture choice. */
function choiceValue(choice) {
    const first = choice?.content?.[0];
    if (first?.element === 'text') return first.text;
    if (first?.element === 'image') return first.src;
    return '';
}

/** The site's own check for a number field (it keeps Submit disabled otherwise). */
const SITE_NUMBER_PATTERN = /^([-+])?([0-9]+(\.[0-9]+)?|Infinity)$/;

/**
 * Turn the model's {id, answer} list into the answer map the site submits, checking it against the
 * question. Formats come from the site's client code: number field ref -> text, slot ref -> card ref,
 * choice ref -> the choice's text.
 *
 * @returns {{answers: Object<string, string>, problems: string[]}}
 */
function normalizeAnswers(results, layoutInfo) {
    const input = layoutInfo.input || {};
    const numberRefs = Object.keys(input.number_fields || {});
    const textRefs = Object.keys(input.text_fields || {});
    const slots = findSlots(layoutInfo.layout?.content);
    const choices = input.choices || {};
    const cards = input.cards || {};

    const answers = {};
    const problems = [];
    const leftovers = [];

    // The card in a group that an answer names, by its three-letter ID or by its text
    const cardIn = (group, answer) => {
        const refs = input.card_groups?.[group]?.card_refs || [];
        return refs.find(ref => ref === answer) || refs.find(ref => cards[ref]?.content?.[0]?.text === answer) || null;
    };

    for (const result of results) {
        // The model sometimes writes "[SLOT:GROUP]" or "SLOT:GROUP"; only the first part is the ref
        const id = String(result.id ?? '').replace(/[\[\]\s()]/g, '').split(':')[0];
        const answer = String(result.answer ?? '').trim();

        if (textRefs.includes(id)) {
            // A typed answer: the site sends the text as typed, trimmed
            if (!answer) problems.push(`text field ${id} is empty`);
            else answers[id] = answer;
            continue;
        }

        if (numberRefs.includes(id)) {
            if (!SITE_NUMBER_PATTERN.test(answer)) problems.push(`number field ${id}: "${answer}" is not a plain number`);
            else answers[id] = answer;
            continue;
        }

        const slot = slots.find(s => s.ref === id);
        if (slot) {
            const refs = input.card_groups?.[slot.accept]?.card_refs || [];
            const byText = refs.find(ref => cards[ref]?.content?.[0]?.text === answer);
            const card = refs.includes(answer) ? answer : byText;

            if (card) answers[id] = card;
            else problems.push(`slot ${id}: "${answer}" is not a card in its group`);
            continue;
        }

        // A multiple-choice answer: the model gives the choice ID as the answer (its own id is not a real ref)
        const choiceRef = choices[answer] ? answer : (choices[id] ? id : null);
        if (choiceRef) {
            const value = choiceValue(choices[choiceRef]);
            if (value) answers[choiceRef] = value;
            else problems.push(`choice ${choiceRef} has no text to send`);
            continue;
        }

        leftovers.push(result);
    }

    // A model that mislabels a slot answer (for example as "choice") still gave a card. Put it in the next
    // empty slot that accepts that card, in reading order. Anything that fits nowhere is a problem.
    for (const result of leftovers) {
        const answer = String(result.answer ?? '').trim();
        const slot = slots.find(s => !(s.ref in answers) && cardIn(s.accept, answer));
        if (slot) answers[slot.ref] = cardIn(slot.accept, answer);
        else problems.push(`unknown answer id "${result.id}"`);
    }

    for (const ref of numberRefs) if (!(ref in answers)) problems.push(`number field ${ref} not answered`);
    for (const ref of textRefs) if (!(ref in answers)) problems.push(`text field ${ref} not answered`);
    for (const slot of slots) if (!(slot.ref in answers)) problems.push(`slot ${slot.ref} not answered`);

    // A card can sit in only one slot of its group
    for (const group of Object.values(input.slot_groups || {})) {
        const used = (group.slot_refs || []).map(ref => answers[ref]).filter(Boolean);
        if (new Set(used).size !== used.length) problems.push('the same card is used in more than one slot');
    }

    // Multiple choice: the number selected must fit each group's limits
    for (const group of Object.values(input.choice_groups || {})) {
        const picked = (group.choice_refs || []).filter(ref => ref in answers).length;
        const min = parseInt(group.min_choices ?? 1);
        const max = parseInt(group.max_choices ?? 1);
        if (picked < min || picked > max) problems.push(`${picked} choices selected, allowed ${min} to ${max}`);
    }

    return { answers, problems };
}

/** Calculate the answer for a multiple choice question. */
function calculateMultipleChoiceAnswer(layoutInfo) {
    const answerIds = [];

    if (layoutInfo.input.choice_groups.choice_group) {
        if (layoutInfo.input.choice_groups.choice_group.max_choices && layoutInfo.input.choice_groups.choice_group.max_choices !== 1) return;
        answerIds.push(layoutInfo.input.choice_groups.choice_group.choice_refs[0]);
    } else {
        const acceptCounts = {};
        for (const answerContent of layoutInfo.layout.content[1].content[0].content) {
            if (!answerContent.type.includes("answer-part")) continue;

            for (const answerPartContent of answerContent.content) {
                if (answerPartContent.element !== "slot") continue;

                if (acceptCounts[answerPartContent.accept]) {
                    acceptCounts[answerPartContent.accept] += 1;
                } else {
                    acceptCounts[answerPartContent.accept] = 1;
                }
            }
        }

        for (const acceptKey of Object.keys(acceptCounts)) {
            const cardGroupKey = Object.keys(layoutInfo.input.card_groups).find(cardGroupKeSearch => cardGroupKeSearch === acceptKey);
            if (!cardGroupKey) continue;

            const cardGroup = layoutInfo.input.card_groups[cardGroupKey];

            for (let i = 0; i < acceptCounts[acceptKey]; i++) {
                answerIds.push(cardGroup.card_refs[i]);
            }
        }
    }

    const answers = {};

    for (const answerId of answerIds) {
        let slotId;
        for (const [cardGroupId, cardGroupData] of Object.entries(layoutInfo.input.card_groups)) {
            if (cardGroupData.card_refs.includes(answerId)) {
                slotId = cardGroupId;
                break;
            }
        }

        let answerContent;
        if (layoutInfo.input.cards[answerId]) {
            answerContent = layoutInfo.input.cards[answerId].content[0].text;
        } else if (layoutInfo.input.choices[answerId]) {
            answerContent = layoutInfo.input.choices[answerId].content[0].text;
        }

        if (slotId) {
            answers[slotId] = answerId;
        } else {
            answers[answerId] = answerContent;
        }
    }

    return Object.keys(answers).length > 0 ? answers : null;
}

// --- OpenRouter AI helpers ---

// --- OpenRouter config (set in .env) ---
// OPENROUTER_API_KEY       required
// OPENROUTER_TEXT_MODEL    required: model ID used for text-only questions
// OPENROUTER_VISION_MODEL  required: model ID used for questions with an image
// OPENROUTER_URL           optional, default https://openrouter.ai/api/v1
// OPENROUTER_REASONING_EFFORT  optional: low, medium (default) or high
//
// These are read when a question is solved, not when this file loads, because
// index.js loads .env after its imports have run.
// ---

function openRouterConfig(isVision) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const modelVar = isVision ? 'OPENROUTER_VISION_MODEL' : 'OPENROUTER_TEXT_MODEL';
    const model = process.env[modelVar];

    const missing = [];
    if (!apiKey) missing.push('OPENROUTER_API_KEY');
    if (!model) missing.push(modelVar);
    if (missing.length > 0) {
        throw new Error(`Missing in .env: ${missing.join(', ')}`);
    }

    return {
        apiKey,
        model,
        baseUrl: (process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
    };
}

const SYSTEM_PROMPT = `You are a maths expert. Work through the problem step by step in your head, then output ONLY a JSON object with no text outside it and no markdown fences.

Required JSON shape:
{"answers":[{"id":"<field-id>","answer":"<value>"}]}

Rules:
- Number fields (shown as "(REF)"): "id" must be exactly REF (the three letters), never a label such as "a" or "b". "answer" must be a plain decimal number only. No fractions, units, words, or symbols except a decimal point and a leading minus sign (e.g. "12", "3.5" or "-32").
- Slots (shown as "[SLOT:GROUP]"): "id" must be exactly SLOT (never "choice"). "answer" must be the exact three-letter card ID from that group's list, NOT the display text. A card can go in only one slot. In a fraction, the first slot is the numerator and the second is the denominator, so they usually need different cards.
- Text boxes (shown as "{REF}"): "id" must be exactly REF. "answer" is a short plain-text term (one to three words), with no maths markup and no explanation.
- Multiple-choice questions: use "choice" as the "id" and the exact three-letter choice ID as the "answer"; give one object per selected choice.
- Include one object per field/slot. Do not merge multiple answers.
- Fill every slot and every number field shown.`;

/**
 * Call the OpenRouter chat completions endpoint.
 * The API key is only sent in the Authorization header and is never logged.
 */
async function openRouterChat(messages, { isVision = false } = {}) {
    const { apiKey, model, baseUrl } = openRouterConfig(isVision);

    const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        // Gemini models bill their thinking tokens as output, so effort is a cost setting. Default is
        // medium: in testing, low effort made the vision model skip thinking and get a calculation wrong.
        // max_tokens covers thinking plus the answer, so leave room for both.
        body: JSON.stringify({
            model,
            messages,
            temperature: 0.1,
            max_tokens: 4096,
            reasoning: { effort: process.env.OPENROUTER_REASONING_EFFORT || 'medium' },
        }),
        signal: AbortSignal.timeout(120000),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`OpenRouter error ${res.status}: ${String(text).slice(0, 300)}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    const text = Array.isArray(content) ? content.map(part => part.text || '').join('') : content;

    if (typeof text !== 'string' || text.length === 0) {
        throw new Error('OpenRouter returned no message content.');
    }

    return text;
}

/**
 * A prompt for any layout that has cards, slots, choices or number boxes, whatever groups they sit in.
 * It reads the answer parts in order, and lists the cards and choices from the question's input data.
 * Used when none of the specific layouts match (ordering questions, Flashcards). Returns null if there is
 * nothing to answer.
 */
function buildGenericPrompt(question, layoutInfo) {
    const input = layoutInfo.input || {};
    const tokens = [];

    const textOf = (nodes) => {
        const out = [];
        const collect = (n) => {
            if (Array.isArray(n)) n.forEach(collect);
            else if (n && typeof n === 'object') { if (n.element === 'text' && n.text) out.push(n.text); if (n.content) collect(n.content); }
        };
        collect(nodes);
        return out.join(' ');
    };

    const walk = (node) => {
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (!node || typeof node !== 'object') return;
        // The question's own text is already in the prompt
        if (node.element === 'group' && (hasType(node, 'question-text') || hasType(node, 'question') || hasType(node, 'question-part'))) return;

        if (node.element === 'text' && node.text) tokens.push(node.text);
        else if (node.element === 'slot') tokens.push(`[${node.ref}:${node.accept}]`);
        else if (node.element === 'number-field') tokens.push(`(${node.ref})`);
        else if (node.element === 'text-field') tokens.push(`{${node.ref}}`);

        if (node.content && node.element !== 'card' && node.element !== 'choice') walk(node.content);
    };
    walk(layoutInfo.layout?.content);

    const slotCount = findSlots(layoutInfo.layout?.content).length;
    const numberCount = Object.keys(input.number_fields || {}).length;
    const textCount = Object.keys(input.text_fields || {}).length;
    const choiceGroups = Object.entries(input.choice_groups || {});
    if (slotCount === 0 && numberCount === 0 && textCount === 0 && choiceGroups.length === 0) return null;

    let body = '';
    if (tokens.length) body += `Answer layout: ${tokens.join(' ')}\n`;

    for (const [groupId, group] of Object.entries(input.card_groups || {})) {
        body += `\n${groupId} Cards:\n`;
        for (const ref of group.card_refs || []) body += `  ${ref}: ${textOf(input.cards?.[ref]?.content)}\n`;
    }

    for (const [, group] of choiceGroups) {
        const min = group.min_choices ?? 1;
        const max = group.max_choices ?? 1;
        body += `\nChoices (select ${min === max ? min : `${min} to ${max}`}):\n`;
        for (const ref of group.choice_refs || []) body += `  ${ref}: ${textOf(input.choices?.[ref]?.content)}\n`;
    }

    const keys = [];
    if (slotCount) keys.push('[SLOT:GROUP] = a slot. Answer with its SLOT as the id and one card ID from that group\'s list as the answer. Fill every slot. A card can go in only one slot, so for an ordering question put the cards in the order the question asks, filling the slots from left to right.');
    if (numberCount) keys.push('(REF) = a number input.');
    if (textCount) keys.push('{REF} = a text box. Answer with its REF as the id and a short plain-text answer (a key term of one to three words).');
    if (choiceGroups.length) keys.push('For the choices, use "choice" as the id and the choice ID as the answer, one object per selected choice.');

    return `Question: ${question}\n\n${body}\nKey: ${keys.join(' ')}`;
}

/**
 * Turn the Sparx question layout into a prompt string.
 * Returns null if the layout type is unrecognised.
 */
function buildPrompt(question, layoutInfo) {
    let answerObject    = null;
    let answerScreenType = null;

    if (layoutInfo.layout.type.includes('free-answer')) {
        answerObject    = layoutInfo.layout.content[1].content[0];
        answerScreenType = 'number-field';
    } else if (layoutInfo.layout.content.find(c => c.type?.includes('answer'))) {
        const answerContent = layoutInfo.layout.content.find(c => c.type?.includes('answer'));

        const screenCheck  = answerContent.content.find(c => c.type?.includes('answer-screen'));
        if (screenCheck)  { answerObject = screenCheck;  answerScreenType = 'answer-screen'; }

        const choicesCheck = answerContent.content.find(c => c.type?.includes('choices'));
        if (choicesCheck) { answerObject = choicesCheck; answerScreenType = 'choices'; }
    }

    if (!answerObject) return buildGenericPrompt(question, layoutInfo);

    switch (answerScreenType) {
        case 'answer-screen': {
            let body = '';
            for (const part of answerObject.content.filter(c => c.type?.includes('answer-part'))) {
                const tokens = [];
                for (const p of part.content) {
                    if (p.element === 'text')              tokens.push(p.text);
                    else if (p.element === 'slot')         tokens.push(`[${p.ref}:${p.accept}]`);
                    else if (p.element === 'number-field') tokens.push(`(${p.ref})`);
                }
                const fraction = part.style === 'fraction' ? ' (a fraction: the first slot is the numerator, the second is the denominator)' : '';
                body += `Answer Part${fraction}: ${tokens.join(' ')}\n`;
            }
            for (const group of answerObject.content.filter(c => c.type?.includes('cards'))) {
                body += `\n${group.id} Choices:\n`;
                for (const card of group.content.filter(c => c.element === 'card')) {
                    const label = card.content.find(c => c.element === 'text')?.text;
                    if (label) body += `  ${card.ref}: ${label}\n`;
                }
            }
            return `Question: ${question}\n\n${body}\nKey: [slotId:groupId] = choose one ID from that group. (ref) = number input. Fill every slot and number field.`;
        }
        case 'choices': {
            let choices = '';
            for (const c of answerObject.content) {
                choices += `  ${c.ref}: ${c.content[0].text}\n`;
            }
            return `Question: ${question}\n\nChoices:\n${choices}\nReturn the ID(s) of the correct choice(s): use "choice" as the id and the choice ID as the answer.`;
        }
        case 'number-field': {
            return `Question: ${question}\n\nNumber field ID: ${answerObject.ref}\nReturn a single plain decimal number.`;
        }
        default:
            return null;
    }
}

/**
 * Extract the answers array from whatever text the model returned.
 * Handles clean JSON, JSON embedded in reasoning text, and markdown fences.
 */
function parseAnswers(raw) {
    // Strip markdown fences if present
    const stripped = raw.replace(/```json?\s*/g, '').replace(/```/g, '').trim();

    try {
        const obj = JSON.parse(stripped);
        if (Array.isArray(obj.answers)) return obj.answers;
    } catch { /* fall through */ }

    // Try to find a JSON object anywhere in the text
    const match = raw.match(/\{[\s\S]*?"answers"[\s\S]*?\}/);
    if (match) {
        try {
            const obj = JSON.parse(match[0]);
            if (Array.isArray(obj.answers)) return obj.answers;
        } catch { /* fall through */ }
    }

    console.warn('[WARN] Could not parse answers from model output:', raw.slice(0, 300));
    return [];
}

/**
 * Ask OpenRouter to solve a Sparx question: the vision model when the question has an
 * image, the text model otherwise.
 */
async function getAnswerFromAI(question, layoutInfo, _outputLength, imageUrl, downloadImage) {
    const promptText = buildPrompt(question, layoutInfo);
    if (!promptText) {
        console.warn(`[WARN] Question layout not supported yet (${(layoutInfo.layout?.type || []).join(', ') || 'unknown type'}), so it was skipped.`);
        return [];
    }

    const isVision = !!imageUrl;

    // Fail fast if the key or model is missing, before downloading anything
    openRouterConfig(isVision);

    // Vision: send the image as a data URL so OpenRouter does not need to reach the Sparx asset host
    let userMessage;
    if (isVision) {
        const { base64: imageBase64, mime } = await (downloadImage || downloadImagePlain)(imageUrl);

        userMessage = {
            role: 'user',
            content: [
                { type: 'text', text: promptText },
                { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}` } },
            ],
        };
    } else {
        userMessage = { role: 'user', content: promptText };
    }

    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        userMessage,
    ];

    const raw = await openRouterChat(messages, { isVision });
    return parseAnswers(raw);
}

/**
 * Fallback path used by getDumbAnswers() — same logic as getAnswerFromAI().
 */
async function getDumbAnswerFromAI(question, layoutInfo, imageUrl, downloadImage) {
    return getAnswerFromAI(question, layoutInfo, 0, imageUrl, downloadImage);
}

/**
 * Plain image download, used only when no browser is open. The Sparx asset host
 * blocks plain requests with a 403, so the logged-in browser path is normally used.
 */
async function downloadImagePlain(url) {
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Could not download the question image (HTTP ${res.status}).`);
    }

    const mime = (res.headers.get('content-type') || 'image/png').split(';')[0];
    return { base64: Buffer.from(await res.arrayBuffer()).toString('base64'), mime };
}

export { Activity, normalizeAnswers };
