// Read-only health check: is everything still working?
//
//   npm.cmd run check            sign in, list homework, read one homework's tasks, load one question, sign out
//   npm.cmd run check -- --ai    also ask the AI for that question's answer (uses a little OpenRouter credit)
//
// It never starts or submits a question, and never opens a homework you haven't opened yet.

import fs from 'node:fs';
import dotenv from 'dotenv';
import Fuse from 'fuse.js';

import { Sparx } from '../classes/Sparx.js';
import { getSchools } from '../classes/School.js';
import { describeAnswers } from '../classes/Runner.js';

dotenv.config();

// The Chrome that comes with Puppeteer does not run on this machine; use the installed one
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
if (!process.env.PUPPETEER_EXECUTABLE_PATH && process.platform === 'win32' && fs.existsSync(chrome)) {
    process.env.PUPPETEER_EXECUTABLE_PATH = chrome;
}

const useAi = process.argv.includes('--ai');
let failures = 0;

const pass = (name, detail = '') => console.log(`\x1b[32mPASS\x1b[0m  ${name}${detail ? `  (${detail})` : ''}`);
const fail = (name, detail = '') => { failures++; console.log(`\x1b[31mFAIL\x1b[0m  ${name}${detail ? `  (${detail})` : ''}`); };
const skip = (name, detail = '') => console.log(`\x1b[33mSKIP\x1b[0m  ${name}${detail ? `  (${detail})` : ''}`);

async function main() {
    const missing = ['SPARX_SCHOOL', 'SPARX_USERNAME', 'SPARX_PASSWORD'].filter(name => !process.env[name]);
    if (missing.length > 0) {
        fail('settings', `add ${missing.join(', ')} to .env`);
        return;
    }

    const schools = await getSchools();
    const school = new Fuse(schools, { keys: ['name', 'address'], threshold: 0.5 }).search(process.env.SPARX_SCHOOL)[0]?.item;
    if (!school) {
        fail('school', 'no school matches SPARX_SCHOOL in .env');
        return;
    }
    pass('school list', `${schools.length} schools, matched ${school.name}`);

    const client = new Sparx(process.env.SPARX_USERNAME, process.env.SPARX_PASSWORD, school);

    try {
        const started = Date.now();
        await client.login();
        pass('sign in', `${Math.round((Date.now() - started) / 1000)}s`);

        const homeworks = await client.getHomeworks();
        if (homeworks.length === 0) {
            fail('homework list', 'no homework found');
            return;
        }

        const progress = await Promise.all(homeworks.map(homework => client.getHomeworkProgress(homework.id).catch(() => null)));
        const unreadable = progress.filter(p => p === null).length;
        const opened = progress.filter(p => p?.started).length;
        if (unreadable > 0) fail('homework progress', `${unreadable} of ${homeworks.length} could not be read`);
        else pass('homework list and progress', `${homeworks.length} homework, ${opened} opened`);

        // Only look inside a homework that has already been opened, so nothing new is generated.
        // Prefer one with answered questions, so the question loaded below is one that is already done.
        const withDone = progress.findIndex(p => p?.started && p.done > 0);
        const index = withDone !== -1 ? withDone : progress.findIndex(p => p?.started);
        if (index === -1) {
            skip('tasks and question', 'no homework has been opened yet');
            return;
        }

        const homework = homeworks[index];
        const overview = await client.getHomeworkOverview(homework.id);
        const items = overview.reduce((sum, task) => sum + task.items.length, 0);
        const done = overview.reduce((sum, task) => sum + task.items.filter(item => item.completed).length, 0);
        if (overview.length > 0) pass('tasks', `${homework.name}: ${overview.length} tasks, ${done}/${items} done`);
        else fail('tasks', `${homework.name}: no tasks`);

        // An already-answered question if there is one, otherwise the first question
        const task = overview.find(t => t.items.some(item => item.completed)) || overview.find(t => t.items.length > 0);
        if (!task) return;
        const item = task.items.find(i => i.completed) || task.items[0];

        const activity = await client.getActivity(homework.id, task.taskId, item.index);
        const fields = Object.keys(activity.layout?.[0]?.input?.number_fields || {}).length
            + Object.keys(activity.layout?.[0]?.input?.choices || {}).length
            + Object.keys(activity.layout?.[0]?.input?.cards || {}).length;
        if (activity.id && fields > 0) pass('load a question', `${task.name}, question ${item.index}${item.completed ? ' (already answered)' : ''}, ${fields} answer fields`);
        else fail('load a question', 'question loaded without answer fields');

        if (useAi) {
            const answers = await activity.getAnswers();
            if (answers) pass('AI answer (not sent)', describeAnswers(answers, activity.layout[0]));
            else fail('AI answer (not sent)', 'no usable answer');
        } else {
            skip('AI answer', 'add --ai to include it');
        }
    } catch (error) {
        fail('check stopped', error.message);
    } finally {
        const signedOut = await client.logout().catch(() => false);
        if (signedOut) pass('sign out');
        else fail('sign out', 'Sparx did not confirm it');
    }
}

await main();
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
