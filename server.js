import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import dotenv from 'dotenv';
import Fuse from 'fuse.js';

import { Sparx } from './classes/Sparx.js';
import { getSchools } from './classes/School.js';
import { runTasks } from './classes/Runner.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SPARX_VARS = ['SPARX_SCHOOL', 'SPARX_USERNAME', 'SPARX_PASSWORD'];
const AI_VARS = ['OPENROUTER_API_KEY', 'OPENROUTER_TEXT_MODEL', 'OPENROUTER_VISION_MODEL'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sign in to Sparx with the details in .env. */
async function makeRealClient(env) {
    const schools = await getSchools();
    const fuse = new Fuse(schools, { keys: ['name', 'address'], includeScore: true, threshold: 0.5 });
    const match = fuse.search(env.SPARX_SCHOOL)[0]?.item;

    if (!match) {
        throw new Error('No matching school found. Try a shorter part of the school name in .env.');
    }

    const client = new Sparx(env.SPARX_USERNAME, env.SPARX_PASSWORD, match);
    let lastError;

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            await client.login();
            return client;
        } catch (error) {
            lastError = error;

            if (error.message.includes('invalid credentials')) {
                throw new Error('Sparx rejected the username or password in .env.');
            }

            client.refreshProxy();
            await sleep(2000 * 2 ** attempt);
        }
    }

    throw new Error(`Could not sign in: ${lastError.message}`);
}

/**
 * The local web app. It only listens on 127.0.0.1, every API call needs the random token printed at
 * start-up, and the Host and Origin headers are checked, so other websites cannot reach it.
 *
 * @param {object} options
 * @param {(env: object) => Promise<object>} options.makeClient - Returns a signed-in client
 * @param {object} [options.env]
 * @param {string} [options.uiDir]
 * @param {() => void} [options.onQuit] - Called after the user presses Quit
 */
export function createApp({ makeClient, env = process.env, uiDir = path.join(here, 'ui'), onQuit = () => {} }) {
    const token = crypto.randomBytes(16).toString('hex');
    const state = { auth: { status: 'out' }, client: null, running: false, stop: false, mode: null };
    const runEvents = [];
    const listeners = new Set();
    let port = 0;

    // ----- events -----
    const broadcast = (event) => {
        for (const res of listeners) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const emitRun = (event) => {
        const stamped = { ...event, t: Date.now() };
        runEvents.push(stamped);
        if (runEvents.length > 500) runEvents.shift();
        broadcast(stamped);
    };

    const emitAuth = () => broadcast({ type: 'auth', ...state.auth });

    // ----- helpers -----
    const securityHeaders = {
        'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store',
    };

    const send = (res, status, body) => {
        res.writeHead(status, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(body));
    };

    const readJson = (req) => new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];

        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > 20000) { reject(new Error('Request too large.')); req.destroy(); return; }
            chunks.push(chunk);
        });
        req.on('end', () => {
            try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
            catch { reject(new Error('Invalid JSON.')); }
        });
        req.on('error', reject);
    });

    const hostAllowed = (req) => {
        const host = req.headers.host;
        return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
    };

    const originAllowed = (req) => {
        const origin = req.headers.origin;
        return !origin || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
    };

    const tokenAllowed = (req, url) => {
        const given = String(req.headers['x-token'] || url.searchParams.get('t') || '');
        const a = Buffer.from(given);
        const b = Buffer.from(token);
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    };

    const missingVars = (names) => names.filter((name) => !env[name]);

    // ----- routes -----
    const handle = async (req, res) => {
        const url = new URL(req.url, 'http://localhost');

        if (!hostAllowed(req) || !originAllowed(req)) {
            return send(res, 403, { error: 'Forbidden.' });
        }

        if (req.method === 'GET' && url.pathname === '/') {
            const html = fs.readFileSync(path.join(uiDir, 'index.html'), 'utf8');
            res.writeHead(200, { ...securityHeaders, 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(html);
        }

        if (!url.pathname.startsWith('/api/')) {
            return send(res, 404, { error: 'Not found.' });
        }

        if (!tokenAllowed(req, url)) {
            return send(res, 401, { error: 'Open the address printed in the terminal; it includes the access token.' });
        }

        const route = `${req.method} ${url.pathname}`;

        if (route === 'GET /api/events') {
            res.writeHead(200, { ...securityHeaders, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
            res.write(`data: ${JSON.stringify({ type: 'auth', ...state.auth, running: state.running })}\n\n`);
            for (const event of runEvents) res.write(`data: ${JSON.stringify(event)}\n\n`);

            listeners.add(res);
            const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 15000);
            req.on('close', () => { clearInterval(heartbeat); listeners.delete(res); });
            return;
        }

        if (route === 'GET /api/config') {
            return send(res, 200, {
                missingSparx: missingVars(SPARX_VARS),
                missingAi: missingVars(AI_VARS),
                textModel: env.OPENROUTER_TEXT_MODEL || null,
                visionModel: env.OPENROUTER_VISION_MODEL || null,
                reasoningEffort: env.OPENROUTER_REASONING_EFFORT || 'medium',
                showBrowser: env.SPARX_HEADLESS === 'false',
            });
        }

        if (route === 'GET /api/state') {
            return send(res, 200, { auth: state.auth, running: state.running, mode: state.mode });
        }

        if (route === 'POST /api/login') {
            if (state.auth.status === 'in' || state.auth.status === 'signing-in') {
                return send(res, 200, { auth: state.auth });
            }

            const missing = missingVars(SPARX_VARS);
            if (missing.length > 0) {
                return send(res, 400, { error: `Add ${missing.join(', ')} to the .env file first.` });
            }

            state.auth = { status: 'signing-in' };
            emitAuth();

            makeClient(env)
                .then((client) => { state.client = client; state.auth = { status: 'in' }; })
                .catch((error) => { state.client = null; state.auth = { status: 'error', message: error.message }; })
                .finally(emitAuth);

            return send(res, 202, { auth: state.auth });
        }

        // Everything below needs a signed-in client
        const needClient = () => {
            if (state.auth.status !== 'in' || !state.client) {
                send(res, 401, { error: 'Sign in first.' });
                return null;
            }
            return state.client;
        };

        if (route === 'POST /api/logout') {
            if (state.running) return send(res, 409, { error: 'A run is in progress. Stop it first.' });

            const client = state.client;
            state.client = null;
            state.auth = { status: 'out' };
            emitAuth();
            if (client) await client.logout().catch(() => {});

            return send(res, 200, { auth: state.auth });
        }

        if (route === 'GET /api/homeworks') {
            const client = needClient();
            if (!client) return;

            const homeworks = await client.getHomeworks();
            homeworks.sort((a, b) => b.due - a.due);

            return send(res, 200, {
                homeworks: homeworks.map((homework) => ({ id: homework.id, name: homework.name, due: homework.due.toISOString() })),
            });
        }

        if (route === 'GET /api/overview') {
            const client = needClient();
            if (!client) return;

            const homeworkId = url.searchParams.get('homework') || '';
            if (!UUID.test(homeworkId)) return send(res, 400, { error: 'Invalid homework.' });

            return send(res, 200, { tasks: await client.getHomeworkOverview(homeworkId) });
        }

        if (route === 'POST /api/run') {
            const client = needClient();
            if (!client) return;

            if (state.running) return send(res, 409, { error: 'A run is already in progress.' });

            const body = await readJson(req);
            const mode = body.mode === 'preview' ? 'preview' : body.mode === 'run' ? 'run' : null;
            const taskIds = Array.isArray(body.taskIds) ? body.taskIds.filter((id) => typeof id === 'string' && UUID.test(id)) : [];

            if (!mode) return send(res, 400, { error: 'Mode must be "preview" or "run".' });
            if (typeof body.homeworkId !== 'string' || !UUID.test(body.homeworkId)) return send(res, 400, { error: 'Invalid homework.' });
            if (taskIds.length === 0) return send(res, 400, { error: 'Choose at least one task.' });

            const missingAi = missingVars(AI_VARS);
            if (missingAi.length > 0) return send(res, 400, { error: `Add ${missingAi.join(', ')} to the .env file first.` });

            state.running = true;
            state.stop = false;
            state.mode = mode;
            runEvents.length = 0;

            runTasks({ client, homeworkId: body.homeworkId, taskIds, mode, emit: emitRun, isStopped: () => state.stop })
                .catch((error) => emitRun({ type: 'run', status: 'error', mode, message: error.message }))
                .finally(() => { state.running = false; });

            return send(res, 202, { started: true, mode });
        }

        if (route === 'POST /api/stop') {
            if (state.running) state.stop = true;
            return send(res, 200, { stopping: state.running });
        }

        if (route === 'POST /api/quit') {
            send(res, 200, { bye: true });
            setTimeout(() => close().finally(onQuit), 50);
            return;
        }

        return send(res, 404, { error: 'Not found.' });
    };

    const server = http.createServer((req, res) => {
        handle(req, res).catch((error) => {
            console.error(error);
            if (!res.headersSent) send(res, 500, { error: 'Something went wrong.' });
            else res.end();
        });
    });

    /** Start listening. Tries the given port, then the next ones, so a busy port does not stop it. */
    const start = (preferredPort = 0) => new Promise((resolve, reject) => {
        let candidate = preferredPort;

        const attempt = () => {
            server.once('error', (error) => {
                if (error.code === 'EADDRINUSE' && preferredPort !== 0 && candidate < preferredPort + 20) {
                    candidate++;
                    attempt();
                } else {
                    reject(error);
                }
            });

            server.listen(candidate, '127.0.0.1', () => {
                server.removeAllListeners('error');
                port = server.address().port;
                resolve(`http://127.0.0.1:${port}/?t=${token}`);
            });
        };

        attempt();
    });

    const close = async () => {
        state.stop = true;
        for (const res of listeners) res.end();
        listeners.clear();

        const client = state.client;
        state.client = null;
        if (client) await client.logout().catch(() => {});

        server.closeAllConnections?.();
        await new Promise((resolve) => server.close(() => resolve()));
    };

    return { server, start, close, state, token };
}

function openBrowser(url) {
    const [command, args] = process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : process.platform === 'darwin'
            ? ['open', [url]]
            : ['xdg-open', [url]];

    spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

async function main() {
    dotenv.config();

    // The Chrome that comes with Puppeteer does not run on this machine; use the installed one
    const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
    if (!process.env.PUPPETEER_EXECUTABLE_PATH && process.platform === 'win32' && fs.existsSync(chrome)) {
        process.env.PUPPETEER_EXECUTABLE_PATH = chrome;
    }

    const app = createApp({
        makeClient: (env) => makeRealClient(env),
        env: process.env,
        onQuit: () => process.exit(0),
    });

    const url = await app.start(Number(process.env.SPARX_UI_PORT) || 4173);

    console.log('\nSparx is running. If the page does not open, paste this into your browser:\n');
    console.log(`  ${url}\n`);
    console.log('Press Ctrl+C here, or use Quit in the page, to stop.\n');

    if (process.env.SPARX_UI_NO_OPEN !== '1') openBrowser(url);

    process.on('SIGINT', () => app.close().finally(() => process.exit(0)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
