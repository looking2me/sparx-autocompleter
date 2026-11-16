import randUserAgent from "rand-user-agent";
import puppeteer from 'puppeteer';

import { School } from "./School.js";
import { Homework, HomeworkTask } from "./Homework.js";
import { Activity } from "./Activity.js";
import { decodeProtoRecursive, TYPES, encodeProto } from "./Protobuf.js";
import { HttpsProxyAgent } from 'https-proxy-agent';

/** Text of a decoded protobuf value (string, Buffer or {type:'bytes'}). */
function protoText(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value).toString('utf8');
    if (value.type === 'bytes') return Buffer.from(value.value).toString('utf8');
    return String(value);
}

/** First decoded field with this index (or undefined). */
function protoGet(parts, index) {
    return parts?.find(p => p.index === index)?.value;
}

/** All decoded fields with this index. */
function protoAll(parts, index) {
    return (parts || []).filter(p => p.index === index).map(p => p.value);
}

/**
 * Decoded fields of a nested message. The decoder reads a nested message made only of printable
 * bytes as a string, so turn such a string back into bytes and decode it again.
 */
function protoParts(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') return decodeProtoRecursive(Buffer.from(value, 'utf8'));
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) return decodeProtoRecursive(Buffer.from(value));
    return [];
}

/** Text inside the site's $...$ markup, without the dollar signs. */
const stripMath = (text) => String(text).replace(/\$/g, '').trim();

/**
 * Strings that must all appear in the bookwork option that matches a question, built from the answers
 * submitted for it. Numbers appear as <number>X</number>, a multiple-choice answer as <choice>TEXT</choice>,
 * and a fraction of two cards as \frac{numerator}{denominator} inside the option's markup.
 */
function bookworkMarkers(answers, layoutInfo) {
    const input = layoutInfo.input || {};
    const markers = [];
    const slotRefs = [];

    (function walk(node) {
        if (Array.isArray(node)) node.forEach(walk);
        else if (node && typeof node === 'object') {
            if (node.element === 'slot') slotRefs.push(node.ref);
            if (node.content) walk(node.content);
        }
    })(layoutInfo.layout?.content);

    for (const ref of Object.keys(input.number_fields || {})) {
        if (ref in answers) markers.push(`<number>${answers[ref]}</number>`);
    }

    for (const ref of Object.keys(input.choices || {})) {
        if (ref in answers) markers.push(`<choice>${answers[ref]}</choice>`);
    }

    const cardTexts = slotRefs
        .filter(ref => ref in answers)
        .map(ref => stripMath(input.cards?.[answers[ref]]?.content?.[0]?.text ?? ''));

    if (cardTexts.length === 2) markers.push(`\\frac{${cardTexts[0]}}{${cardTexts[1]}}`);
    else markers.push(...cardTexts);

    return markers;
}

const PACKAGES_URL ='https://api.sparx-learning.com/maths/sparx.packageactivity.v1.Packages/';
const ACTIVITIES_URL = 'https://api.sparx-learning.com/maths/sparx.packageactivity.v1.Activities/';

/** Represents a Sparx client. */
class Sparx {
    /**
     * Create a Sparx client.
     * 
     * @param {string} username - The username of the client
     * @param {string} password - The password of the client
     * @param {School} school - The school of the client
     */
    constructor(username, password, school, cookies) {
        if ((!username || !password || !school) && !cookies) {
            throw new TypeError("You must provide a username, password, and school OR cookies.");
        }

        this.username = username;
        this.password = password;
        this.school = school;
        this.usesCookies = false;

        if (cookies) {
            this.cookies = cookies;
            this.usesCookies = true;
        } else {
            this.cookies = {
                'live-resolver-school': this.school.slug,
                'cookie_preferences': '{"GA":false,"Hotjar":false,"PT":false,"version":4}',
            };
        }

        this.token = null;
        this.sessionId = null;

        this.refreshProxy();
    }

    refreshProxy() {
        const portNumber = Math.floor(Math.random() * 9999) + 10000;
        const proxyUrl = process.env.DATAIMPULSE_API_URL + ':' + portNumber;
        this.agent = process.env.DATAIMPULSE_API_URL ? new HttpsProxyAgent(proxyUrl) : null;
    }

    /** Set cookies from response. */
    _setCookies(response) {
        const cookies = response.headers.raw()['set-cookie'];

        if (!cookies) return;

        for (const cookie of cookies) {
            const [name, value] = cookie.split(';')[0].split("=");
            this.cookies[name] = value;
        }
    }

    /** Get cookies. */
    _getCookies() {
        return Object.entries(this.cookies).map(([name, value]) => `${name}=${value}`).join("; ");
    }

    /** Login using a real browser to bypass Cloudflare bot protection. */
    async _loginWithPuppeteer() {
        const browser = await puppeteer.launch({
            // Headless by default. Set SPARX_HEADLESS=false to watch the browser.
            headless: process.env.SPARX_HEADLESS !== 'false',
            // Read when launching (Puppeteer only reads the variable when it is first imported, which is too early)
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            defaultViewport: null,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
                '--start-maximized',
            ],
        });

        try {
            const page = await browser.newPage();
            await page.setUserAgent(randUserAgent('desktop', 'chrome', 'windows'));

            // Capture Bearer token + session ID from outgoing requests via CDP.
            // CDP preserves original header casing; Puppeteer's request listener
            // lowercases all keys — we check both to be safe.
            let tokenResolve;
            const tokenCaptured = new Promise(resolve => { tokenResolve = resolve; });

            const captureToken = (headers) => {
                const auth = headers['authorization'] || headers['Authorization'];
                const sid  = headers['x-session-id']  || headers['X-Session-Id'];

                if (auth && auth.toLowerCase().startsWith('bearer ') && !this.token) {
                    // The site sends a lowercase "bearer " prefix; the API rejects "Bearer " with an internal error.
                    this.token = 'bearer ' + auth.slice(auth.toLowerCase().indexOf('bearer ') + 7);
                }
                if (sid && !this.sessionId) {
                    this.sessionId = sid;
                }
                if (this.token && this.sessionId && tokenResolve) {
                    tokenResolve();
                    tokenResolve = null;
                }
            };

            const cdpClient = await page.target().createCDPSession();
            await cdpClient.send('Network.enable');
            cdpClient.on('Network.requestWillBeSent', (event) => captureToken(event.request.headers));
            page.on('request', (request) => captureToken(request.headers()));

            // The page generates its own session ID for API calls. Keep ours in sync with it.
            page.on('request', (request) => {
                const sid = request.headers()['x-session-id'];
                if (sid && request.url().includes('api.sparx-learning.com')) {
                    this.sessionId = sid;
                }
            });

            // Pre-seed the school slug cookie so Sparx skips the school-selector page.
            for (const domain of ['.sparxmaths.uk', '.sparx-learning.com', 'maths.sparx-learning.com']) {
                await page.setCookie({
                    name: 'live-resolver-school',
                    value: this.school.slug,
                    domain,
                    path: '/',
                    httpOnly: false,
                    secure: true,
                });
            }

            const startUrl = `https://maths.sparx-learning.com/student`;
            await page.goto(startUrl, { waitUntil: 'networkidle2', timeout: 60000 });

            // Give Cloudflare challenge time to resolve if it appears
            await new Promise(r => setTimeout(r, 3000));

            // If the cookie didn't bypass the school selector, handle the UI manually
            if (page.url().includes('selectschool')) {
                const inputSel = 'input[type="text"], input[placeholder], input:not([type])';
                await page.waitForSelector(inputSel, { timeout: 30000 });
                await page.click(inputSel);
                await page.type(inputSel, this.school.name, { delay: 60 });

                await new Promise(r => setTimeout(r, 2000));

                const dropdownSel = [
                    '[role="option"]',
                    '[role="listbox"] li',
                    'ul[class*="suggestion"] li',
                    'ul[class*="result"] li',
                    '[class*="autocomplete"] li',
                    '[class*="dropdown"] li',
                    'li[class*="school"]',
                    'li',
                ].join(', ');

                try {
                    await page.waitForSelector(dropdownSel, { timeout: 10000 });
                    await page.evaluate((sel) => {
                        const el = document.querySelector(sel);
                        if (el) el.click();
                    }, dropdownSel);
                } catch (_) {
                    await page.keyboard.press('Enter');
                }

                await new Promise(r => setTimeout(r, 800));

                const continueBtn = await page.$('button:not([disabled]), input[type="submit"]');
                if (continueBtn) {
                    await page.evaluate((sel) => {
                        const btn = document.querySelector(sel);
                        if (btn) btn.click();
                    }, 'button:not([disabled]), input[type="submit"]');
                }

                await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
                await new Promise(r => setTimeout(r, 3000));
            }

            // Wait for the login form
            await page.waitForSelector('input[name="username"]', { timeout: 60000 });

            await page.type('input[name="username"]', this.username, { delay: 40 });
            await page.type('input[name="password"]', this.password, { delay: 40 });

            await page.waitForFunction(
                () => Array.from(document.querySelectorAll('button')).some(b => /log\s*in/i.test(b.textContent.trim()) && !/microsoft/i.test(b.textContent)),
                { timeout: 15000 }
            );

            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
                page.evaluate(() => {
                    const btn = Array.from(document.querySelectorAll('button')).find(b => /log\s*in/i.test(b.textContent.trim()) && !/microsoft/i.test(b.textContent));
                    if (btn) btn.click();
                }),
            ]);

            const finalUrl = page.url();

            if (
                finalUrl.includes('/oauth2/') ||
                finalUrl.includes('/login') ||
                finalUrl.includes('auth.sparxmaths.uk') ||
                finalUrl.includes('auth.sparx-learning.com')
            ) {
                throw new Error('Failed to login on initial request due to invalid credentials.');
            }

            // If the app landed on a non-homework page it may not have fired
            // authenticated API calls yet — navigate to homework to trigger them.
            if (!this.token) {
                await page.goto(
                    `https://${this.school.slug}.sparxmaths.uk/student/homework`,
                    { waitUntil: 'domcontentloaded', timeout: 20000 }
                ).catch(() => {});
            }

            // Wait up to 20 s for both token + session ID.
            // Headless resolves this in well under 5 s normally.
            await Promise.race([
                tokenCaptured,
                new Promise(r => setTimeout(r, 20000)),
            ]);

            if (!this.token) {
                throw new Error('Could not capture API token — the app never made an authenticated request.');
            }

            // Collect ALL cookies across all domains (page.cookies() only returns
            // cookies for the current URL, missing auth cookies on other subdomains).
            const { cookies: allCookies } = await cdpClient.send('Network.getAllCookies');
            for (const cookie of allCookies) {
                this.cookies[cookie.name] = cookie.value;
            }

        } finally {
            // Keep the browser open for the whole run if login succeeded; logout() closes it.
            if (this.token) {
                this.browser = browser;
            } else {
                await browser.close();
            }
        }
    }

    /** Token is captured during _loginWithPuppeteer via CDP — nothing to do here. */
    async _refreshToken() {
        if (!this.token) {
            throw new Error('No API token available. Login may have failed.');
        }
    }

    /** Login to Sparx. */
    async login() {
        if (!this.usesCookies) {
            await this._loginWithPuppeteer();
        }

        await this._refreshToken();
    }

    /**
     * Sign out the way the site does: POST /oauth2/logout from inside the logged-in page, so its
     * cookies go with it (a plain Node request is blocked by Cloudflare). Then close the browser.
     * The access token itself stays valid until it expires; that is how the site's tokens work.
     *
     * @returns {Promise<boolean>} True if Sparx accepted the sign-out
     */
    async logout() {
        let signedOut = false;

        if (this.browser) {
            try {
                const pages = await this.browser.pages();
                const page = pages.find(p => p.url().includes('sparx-learning.com')) || pages[pages.length - 1];

                const status = await page.evaluate(async () => {
                    const response = await fetch('https://api.sparx-learning.com/oauth2/logout', { method: 'POST', credentials: 'include' });
                    return response.status;
                });

                signedOut = status >= 200 && status < 400;
                if (!signedOut) console.warn(`[WARN] Sign-out returned status ${status}.`);
            } catch (err) {
                console.warn('[WARN] Sign-out request failed:', err.message);
            }

            await this.browser.close().catch(() => {});
            this.browser = null;
        }

        return signedOut;
    }

    /**
     * Make a gRPC-web call from inside the logged-in browser tab.
     * Plain HTTP requests from Node are blocked by Cloudflare (403 "Checking your browser"),
     * so the request is sent from the page, which also sends its own cookies.
     *
     * @param {string} url - The API URL
     * @param {string} bodyBase64 - The request body, base64-encoded
     * @returns {Promise<Buffer>} The response body
     */
    async _browserGrpc(url, bodyBase64) {
        if (!this.browser) {
            throw new Error('Browser is not open. Log in first.');
        }

        const pages = await this.browser.pages();
        const page = pages.find(p => p.url().includes('sparx-learning.com')) || pages[pages.length - 1];

        const result = await page.evaluate(async (url, bodyBase64, token, sessionId) => {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': token,
                    'Content-Type': 'application/grpc-web+proto',
                    'x-grpc-web': '1',
                    'x-session-id': sessionId,
                },
                body: Uint8Array.from(atob(bodyBase64), c => c.charCodeAt(0)),
                credentials: 'include',
            });

            const bytes = new Uint8Array(await response.arrayBuffer());
            let binary = '';
            for (const byte of bytes) binary += String.fromCharCode(byte);

            return {
                status: response.status,
                grpcStatus: response.headers.get('grpc-status'),
                body: btoa(binary),
            };
        }, url, bodyBase64, this.token, this.sessionId);

        if (result.status !== 200) {
            throw new Error(`Request failed (HTTP ${result.status}).`);
        }

        if (result.grpcStatus !== null) {
            throw new Error('Request failed with gRPC status ' + result.grpcStatus);
        }

        const body = Buffer.from(result.body, 'base64');
        this._checkGrpcTrailer(body);

        return body;
    }

    /**
     * gRPC-web sends the status in a trailer frame at the end of the body (flag byte 0x80,
     * text like "grpc-status: 0"). An error status can arrive there with HTTP 200, so read it.
     * Throws if the status is not 0; does nothing if there is no trailer.
     */
    _checkGrpcTrailer(buffer) {
        let offset = 0;

        while (offset + 5 <= buffer.length) {
            const flag = buffer[offset];
            const length = buffer.readUInt32BE(offset + 1);
            const end = offset + 5 + length;
            if (end > buffer.length) return;

            if (flag & 0x80) {
                const text = buffer.subarray(offset + 5, end).toString('utf8');
                const status = text.match(/grpc-status:\s*(\d+)/i);
                if (status && status[1] !== '0') {
                    const message = text.match(/grpc-message:\s*([^\r\n]*)/i);
                    throw new Error(`Request failed with gRPC status ${status[1]}${message ? ': ' + message[1] : ''}`);
                }
            }

            offset = end;
        }
    }

    /**
     * Download a question image through the logged-in browser.
     * Plain Node requests to the asset host get a 403, so the picture is loaded in the page
     * the same way the site loads it (an <img> tag, with the site as referrer) and captured
     * as a PNG screenshot of that element. This works even without CORS headers.
     *
     * @param {string} url - The image URL
     * @returns {Promise<{base64: string, mime: string}>}
     */
    async downloadImage(url) {
        if (!this.browser) {
            throw new Error('Browser is not open. Log in first.');
        }

        const pages = await this.browser.pages();
        const page = pages.find(p => p.url().includes('sparx-learning.com')) || pages[pages.length - 1];

        await page.evaluate((src) => new Promise((resolve, reject) => {
            const old = document.getElementById('__sparx_question_image');
            if (old) old.remove();

            const img = document.createElement('img');
            img.id = '__sparx_question_image';
            img.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647;max-width:none;max-height:none;background:#fff';
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('The question image failed to load in the browser.'));
            img.src = src;
            document.body.appendChild(img);
        }), url);

        try {
            const element = await page.$('#__sparx_question_image');
            const png = await element.screenshot({ type: 'png' });
            return { base64: Buffer.from(png).toString('base64'), mime: 'image/png' };
        } finally {
            await page.evaluate(() => document.getElementById('__sparx_question_image')?.remove()).catch(() => {});
        }
    }

    /**
     * Get the homework list from the current Sparx Learning API.
     * Question counts are not in this response yet, so they are set to 0.
     */
    async getHomeworks() {
        const responseBuffer = await this._browserGrpc(
            'https://api.sparx-learning.com/maths/sparx.packageactivity.v1.Packages/ListStudentPackages',
            'AAAAAA4SDAi954LUBhDA0qrIAw=='
        );

        const decoded = decodeProtoRecursive(responseBuffer);
        const homeworks = [];

        for (const entry of decoded) {
            if (entry.index !== 1 || !Array.isArray(entry.value)) continue;

            const field = (index) => entry.value.find(value => value.index === index);
            if (field(3)?.value !== 'homework') continue;

            // Field 1: "packages/<uuid>", field 8: start time, field 9: due time (unix seconds)
            const id = field(1).value.replace(/^packages\//, '');
            const created = new Date(parseInt(field(8).value[0].value) * 1000);
            const due = new Date(parseInt(field(9).value[0].value) * 1000);
            const dueText = due.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

            homeworks.push(new Homework(this, id, created, due, `Homework due ${dueText}`, 0, 0, 0, 0, 0));
        }

        homeworks.sort((a, b) => a.due - b.due);

        return homeworks;
    }

    /** Wrap an encoded protobuf message in a gRPC-web frame (flag byte + 4-byte length). */
    _grpcFrame(message) {
        const header = Buffer.alloc(5);
        header.writeUInt32BE(message.length, 1);
        return Buffer.concat([header, message]);
    }

    /**
     * Parse a GetPackage response. Captured shape:
     * field 1 = package; its field 7 holds tasks (each under field 1). A task has
     * field 1 = "packages/<pkg>/tasks/<taskId>", field 2 = index (absent for Task 1),
     * field 3 = name, field 5 = items. An item has field 1 = ".../items/<n>", field 2 = name,
     * and repeated field 5 key/value pairs (taskType, max_attempts, weights).
     * Completion state is NOT in this response.
     *
     * @param {Buffer} buffer - The response body
     * @returns {{taskId: string, index: number, name: string, items: {path: string, name: string, taskType: string, maxAttempts: number}[]}[]}
     */
    _parsePackageTasks(buffer) {
        const top = decodeProtoRecursive(buffer);
        const pkg = protoGet(top, 1) || [];

        const tasks = [];
        for (const wrapper of protoAll(pkg, 7)) {
            for (const taskParts of protoAll(wrapper, 1)) {
                const path = protoText(protoGet(taskParts, 1));
                const items = [];

                for (const itemWrapper of protoAll(taskParts, 5)) {
                    for (const itemParts of protoAll(itemWrapper, 1)) {
                        const attrs = {};
                        for (const attr of protoAll(itemParts, 5)) {
                            attrs[protoText(protoGet(attr, 1))] = protoText(protoGet(attr, 2));
                        }

                        // Field 3 is an empty string until the item has been answered, then it holds
                        // progress fields (seen: {1:1, 2:1, 3:1, 6:time, 7:1, 12:1} after a correct first try).
                        const progressParts = protoGet(itemParts, 3);
                        const progress = Array.isArray(progressParts)
                            ? Object.fromEntries(progressParts.filter(p => !Array.isArray(p.value)).map(p => [p.index, protoText(p.value)]))
                            : null;

                        items.push({
                            path: protoText(protoGet(itemParts, 1)),
                            name: protoText(protoGet(itemParts, 2)),
                            taskType: attrs.taskType || '',
                            maxAttempts: parseInt(attrs.max_attempts || '0', 10),
                            progress,
                            // Finished means the item's status is CORRECT (field 1 = 1) and its completed flag is set
                            // (field 2 = 1). Other statuses: 2 incorrect, 3 skipped, 4 pending. A Flashcards item part-way
                            // through its cards is not finished, even though its first card was answered correctly.
                            completed: progress !== null && progress[1] === '1' && progress[2] === '1',
                        });
                    }
                }

                tasks.push({
                    taskId: path.split('/tasks/')[1] || '',
                    index: parseInt(protoText(protoGet(taskParts, 2)) || '0', 10),
                    name: protoText(protoGet(taskParts, 3)),
                    items,
                });
            }
        }

        return tasks;
    }

    /**
     * Fetch a package (homework) and parse its tasks.
     *
     * GetPackage has no tasks until the homework's questions have been generated. The site generates
     * them with GeneratePackageContents the first time a homework is opened, so this does the same.
     * Generating is what opening the homework on the site does: it does not start or answer anything.
     *
     * @param {string} packageId - The package UUID
     * @param {{generate?: boolean}} [options] - generate: false only reads, and returns [] for a homework never opened
     */
    async _getPackageTasks(packageId, { generate = true } = {}) {
        const body = this._grpcFrame(encodeProto([
            { index: 1, type: TYPES.LENDELIM, value: `packages/${packageId}` },
        ])).toString('base64');

        const tasks = this._parsePackageTasks(await this._browserGrpc(PACKAGES_URL + 'GetPackage', body));
        if (tasks.length > 0 || !generate) return tasks;

        // Captured: the first call returns the package with its tasks; a repeat call returns it without them
        const generated = this._parsePackageTasks(await this._browserGrpc(PACKAGES_URL + 'GeneratePackageContents', body));
        if (generated.length > 0) return generated;

        return this._parsePackageTasks(await this._browserGrpc(PACKAGES_URL + 'GetPackage', body));
    }

    /**
     * How far along a homework is, without opening it: a homework that was never opened is reported
     * as not started instead of having its questions generated.
     *
     * @param {string} homeworkId - The package UUID
     * @returns {Promise<{started: boolean, done: number, total: number}>}
     */
    async getHomeworkProgress(homeworkId) {
        const tasks = await this._getPackageTasks(homeworkId, { generate: false });
        const items = tasks.flatMap(task => task.items);

        return {
            started: items.length > 0,
            done: items.filter(item => item.completed).length,
            total: items.length,
        };
    }

    /**
     * Get the tasks of a homework from the new API.
     *
     * @param {string} homeworkId - The package UUID (without the "packages/" prefix)
     * @returns {Promise<HomeworkTask[]>}
     */
    async getHomeworkTasks(homeworkId) {
        const tasks = await this._getPackageTasks(homeworkId);

        return tasks.map(t => {
            const done = t.items.filter(item => item.completed).length;
            const task = new HomeworkTask(this, homeworkId, t.index, t.name, t.items.length, done, t.items.length > 0 && done === t.items.length);
            task.taskId = t.taskId;
            return task;
        });
    }

    /**
     * List the items (questions) of one task.
     * `completed` is true when the item's progress field (item field 3 in GetPackage) is filled in.
     * That rule comes from one observed case (a correct first try). An item that was answered wrong,
     * or has attempts left, has not been seen yet, so it may also count as completed here.
     */
    async getTaskActivities(packageId, taskId) {
        const tasks = await this._getPackageTasks(packageId);
        const task = tasks.find(t => t.taskId === taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found in package ${packageId}.`);
        }

        return task.items.map(item => ({
            activityIndex: parseInt(item.path.split('/items/')[1], 10),
            completed: item.completed,
            completionKnown: true,
            progress: item.progress,
            name: item.name,
            taskType: item.taskType,
            maxAttempts: item.maxAttempts,
        }));
    }

    /**
     * Parse a GetActivity response. Captured shape:
     * field 1 = "activities/<uuid>", field 2 = item path,
     * field 4 = { field 1: { field 2: { field 1: question layout JSON (array) }, field 3: question id },
     *             field 3: id }.
     */
    _parseActivity(buffer) {
        // The decoded top level also holds the gRPC trailer, so the message is field 1.
        const message = protoGet(decodeProtoRecursive(buffer), 1) || [];
        const inner = protoGet(protoGet(message, 4), 1) || [];
        const questionId = protoText(protoGet(inner, 3));
        const layoutJson = protoText(protoGet(protoGet(inner, 2), 1));

        if (!layoutJson) {
            throw new Error('Unexpected GetActivity response: no question layout.');
        }

        return {
            activityId: protoText(protoGet(message, 1)),
            questionId,
            layout: JSON.parse(layoutJson),
        };
    }

    /**
     * Load one item (question) of a task. This call is read-only; the
     * start is registered separately by registerActivityStart().
     *
     * @param {string} packageId - The package UUID
     * @param {string} taskId - The task UUID
     * @param {number} activityIndex - The item number, starting at 1
     * @returns {Promise<Activity>}
     */
    async getActivity(packageId, taskId, activityIndex) {
        const itemPath = `packages/${packageId}/tasks/${taskId}/items/${activityIndex}`;
        const body = this._grpcFrame(encodeProto([
            { index: 2, type: TYPES.LENDELIM, value: itemPath },
        ]));

        const response = await this._browserGrpc(ACTIVITIES_URL + 'GetActivity', body.toString('base64'));
        const parsed = this._parseActivity(response);

        return new Activity(this, taskId, activityIndex, parsed.activityId, parsed.questionId, parsed.layout);
    }

    /**
     * Register the start of an item (an attempt on the account).
     * Not called by any test yet: it counts as an attempt.
     *
     * @param {string} activityId - "activities/<uuid>" from getActivity()
     */
    async registerActivityStart(activityId) {
        const body = this._grpcFrame(encodeProto([
            { index: 1, type: TYPES.LENDELIM, value: activityId },
            { index: 3, type: TYPES.LENDELIM, value: '' },
        ]));

        await this._browserGrpc(ACTIVITIES_URL + 'ActivityAction', body.toString('base64'));
    }

    /**
     * One request that gives everything the interface needs for a homework: its tasks, each task's
     * items, and which items are done.
     *
     * @param {string} homeworkId - The package UUID (without the "packages/" prefix)
     * @returns {Promise<{taskId: string, name: string, items: {index: number, name: string, taskType: string, completed: boolean}[]}[]>}
     */
    async getHomeworkOverview(homeworkId) {
        const tasks = await this._getPackageTasks(homeworkId);

        return tasks.map(task => ({
            taskId: task.taskId,
            name: task.name,
            items: task.items.map(item => ({
                index: parseInt(item.path.split('/items/')[1], 10),
                name: item.name,
                taskType: item.taskType,
                completed: item.completed,
            })),
        }));
    }

    /**
     * Parse an ActivityAction response that followed an answer submission.
     * Captured shape: field 1 = message; message field 4 -> field 1 -> field 3 = the result block:
     * field 3 = submitted answers (ref, value), field 4 = per-ref values, field 7 = per-part state
     * ("1" for every part in the captured correct-looking answer).
     * "1" = correct: confirmed for a correct answer (the screen said correct, 15 Nov 2026).
     * The shape for a wrong answer has not been captured, so a wrong answer is not confirmed yet.
     */
    _parseSubmitResult(buffer) {
        const message = protoGet(decodeProtoRecursive(buffer), 1) || [];
        const block = protoGet(protoGet(protoGet(message, 4), 1), 3) || [];
        // Multi-part questions list a state per part (field 7). Every question lists a result per
        // field (field 4: ref, then {1: state}). Free-answer questions have no parts, so use both.
        const parts = protoAll(block, 7).map(p => ({
            part: protoText(protoGet(p, 1)),
            state: protoText(protoGet(p, 2)),
        }));
        const fields = protoAll(block, 4).map(f => ({
            ref: protoText(protoGet(f, 1)),
            state: protoText(protoGet(protoGet(f, 2), 1)),
        }));

        const states = [...parts.map(p => p.state), ...fields.map(f => f.state)];

        return {
            parts,
            fields,
            correct: states.length > 0 && states.every(state => state === '1'),
        };
    }

    /**
     * Submit answers to one item (a real submission: it counts on the account).
     *
     * @param {Homework} homework - Not used by the new API; kept for the call signature
     * @param {string} activityId - "activities/<uuid>" from getActivity()
     * @param {Object<string, string>} answers - Field ref to answer, e.g. { NZF: "5", XPD: "-32" }
     * @returns {Promise<boolean>} True if every part was marked "1" (see _parseSubmitResult)
     */
    async submitAnswer(homework, activityId, answers, bookworkCode) {
        const answerEntries = Object.entries(answers).map(([ref, value]) => ({
            index: 1,
            type: TYPES.LENDELIM,
            value: [
                { index: 1, type: TYPES.LENDELIM, value: String(ref) },
                { index: 2, type: TYPES.LENDELIM, value: String(value) },
            ],
        }));

        const body = this._grpcFrame(encodeProto([
            { index: 1, type: TYPES.LENDELIM, value: activityId },
            { index: 2, type: TYPES.LENDELIM, value: answerEntries },
        ]));

        const response = await this._browserGrpc(ACTIVITIES_URL + 'ActivityAction', body.toString('base64'));
        // Kept so an unexpected verdict can be inspected without submitting again
        this.lastSubmitResponse = response;
        return this._parseSubmitResult(response).correct;
    }

    /**
     * Ask whether a task has a bookwork check waiting. Message shapes come from the site's own
     * protobuf definitions: GetBookworkCheckRequest { task_name }, response { bookwork_code,
     * options[] { filled_answer_template } }. This is a read; it throws (gRPC status such as
     * FAILED_PRECONDITION or NOT_FOUND) when no check applies yet.
     *
     * @returns {Promise<{code: string, options: string[]}>}
     */
    async getTaskBookworkCheck(packageId, taskId) {
        const body = this._grpcFrame(encodeProto([
            { index: 1, type: TYPES.LENDELIM, value: `packages/${packageId}/tasks/${taskId}` },
        ]));

        const response = await this._browserGrpc(ACTIVITIES_URL + 'GetBookworkCheck', body.toString('base64'));

        // These responses are the message itself (not wrapped in a field 1 like GetActivity's)
        const message = decodeProtoRecursive(response);

        return {
            code: protoText(protoGet(message, 1)),
            options: protoAll(message, 2).map(option => protoText(protoGet(protoParts(option), 1))),
        };
    }

    /**
     * Answer a task's bookwork check by choosing one of the options.
     * AnswerBookworkCheckRequest { task_name, choice (int32) }, response { success (bool) }.
     * The site's dialog passes the option's position in the list; this sends the number you give it.
     *
     * @param {number} choice - Position of the chosen option, starting at 0
     * @returns {Promise<boolean>}
     */
    async answerTaskBookworkCheck(packageId, taskId, choice) {
        const body = this._grpcFrame(encodeProto([
            { index: 1, type: TYPES.LENDELIM, value: `packages/${packageId}/tasks/${taskId}` },
            { index: 2, type: TYPES.VARINT, value: choice },
        ]));

        const response = await this._browserGrpc(ACTIVITIES_URL + 'AnswerBookworkCheck', body.toString('base64'));
        const message = decodeProtoRecursive(response);

        return protoText(protoGet(message, 1)) === '1';
    }

    /**
     * Answer a task's bookwork check, if one is waiting, using the answers submitted in this run.
     * The check names a question by code ("1B" = question 2 of task 1) and offers four of the student's own
     * answers; the right one is the answer given to that question (see _parseSubmitResult's neighbours
     * for the formats). Never guesses: it only answers when exactly one option matches.
     *
     * @param {string} packageId
     * @param {string} taskId
     * @param {{itemIndex: number, answers: Object<string,string>, layout: object}[]} history - Submitted items
     * @returns {Promise<{status: 'none'|'passed'|'failed'|'skipped'|'ambiguous', code?: string, message: string}>}
     */
    async completeTaskBookwork(packageId, taskId, history = []) {
        let check;
        try {
            check = await this.getTaskBookworkCheck(packageId, taskId);
        } catch (error) {
            // 3 invalid argument, 5 not found, 6 already exists (answered), 9 failed precondition (not due yet)
            if (/gRPC status (3|5|6|9)\b/.test(error.message)) return { status: 'none', message: error.message };
            throw error;
        }

        if (!check.code || check.options.length === 0) return { status: 'none', code: check.code, message: 'no options' };

        const itemIndex = check.code.charCodeAt(check.code.length - 1) - 64; // "1B" -> 2
        const item = history.find(entry => entry.itemIndex === itemIndex);
        if (!item) {
            return { status: 'skipped', code: check.code, message: `no answer from this run for question ${itemIndex}; answer it on the site` };
        }

        const markers = bookworkMarkers(item.answers, item.layout);
        const matches = check.options
            .map((option, index) => (markers.length > 0 && markers.every(marker => option.includes(marker)) ? index : -1))
            .filter(index => index >= 0);

        if (matches.length !== 1) {
            return { status: 'ambiguous', code: check.code, message: `${matches.length} options matched; answer it on the site` };
        }

        // The site sends the option's position + 1 (0 means "I didn't write this down")
        const passed = await this.answerTaskBookworkCheck(packageId, taskId, matches[0] + 1);
        return { status: passed ? 'passed' : 'failed', code: check.code, message: passed ? 'passed' : 'not passed' };
    }
}

export { Sparx };