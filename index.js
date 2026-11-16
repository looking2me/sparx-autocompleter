import { Sparx } from "./classes/Sparx.js";
import { getSchools } from "./classes/School.js";

import dotenv from "dotenv";
dotenv.config();

import readline from "node:readline";
import Fuse from "fuse.js";

function loadingAnimation(
    text = "",
    color = "\x1b[0m",
    chars = ["⠙", "⠘", "⠰", "⠴", "⠤", "⠦", "⠆", "⠃", "⠋", "⠉"],
    delay = 100
) {
    let x = 0;

    return setInterval(function() {
        process.stdout.write("\r" + text + " " + color + chars[x++] + "\x1b[0m");
        x = x % chars.length;
    }, delay);
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

async function getInput(question) {
    return await new Promise(resolve => {
        rl.question(question, answer => {
            resolve(answer);
        });
    });
}

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

(async () => {
    const schoolsLoader = loadingAnimation("Fetching schools:");
    const schools = await getSchools();
    clearInterval(schoolsLoader);
    process.stdout.write("\r\x1b[32mFetching schools: ✓\x1b[0m\n");

    let client;

    const username = process.env.SPARX_USERNAME;
    const password = process.env.SPARX_PASSWORD;
    const schoolName = process.env.SPARX_SCHOOL;

    if (username && password && schoolName) {
        const fuseOptions = {
            keys: ['name', 'address'],
            includeScore: true,
            threshold: 0.5,
        };

        const fuse = new Fuse(schools, fuseOptions);
        const findSchoolLoader = loadingAnimation("Finding school:");
        const results = fuse.search(schoolName);

        const bestMatch = results[0]?.item;

        clearInterval(findSchoolLoader);

        if (!bestMatch) {
            process.stdout.write("\r\x1b[31mNo matching school found\x1b[0m\n");
            process.exit(1);
        }

        process.stdout.write(`\r\x1b[32mFound school: \x1b[0m${bestMatch.name}\n`);

        client = new Sparx(username, password, bestMatch);
    } else if (process.env.SPARX_TOKENS) {
        client = new Sparx(null, null, null, JSON.parse(Buffer.from(process.env.SPARX_TOKENS, "base64").toString("utf-8")));
    } else {
        console.log("Please provide the following environment variables:");
        console.log("- SPARX_USERNAME");
        console.log("- SPARX_PASSWORD");
        console.log("- SPARX_SCHOOL");
        // console.log("OR");
        // console.log("- SPARX_TOKENS");
        process.exit(1);
    }


    process.on("uncaughtException", async error => {
        console.error(error);
        
        try {
            await client.logout();
        } catch (error) {
            console.error(error);
        }

        process.exit(1);
    });

    let loginLoader = loadingAnimation("Logging in (this may take a while):");
    let loginAttempts = 0;

    while (true) {
        if (loginAttempts >= 9) {
            clearInterval(loginLoader);
            process.stdout.write("\r\x1b[31mFailed to login after multiple attempts\x1b[0m\n");
            process.exit(1);
        }

        try {
            await client.login();
            break;
        } catch (error) {
            clearInterval(loginLoader);
            process.stdout.clearLine(0);

            console.error(`\n\x1b[31mLogin error (attempt ${loginAttempts + 1}):\x1b[0m ${error.message}`);
            
            if (error.message.includes("invalid credentials")) {
                process.stdout.write("\r\x1b[31mInvalid credentials. Please check them and try again.\x1b[0m\n");
                process.exit(1);
            }

            loginLoader = loadingAnimation(`Logging in (attempt ${loginAttempts+2}):`);

            client.refreshProxy();
            await new Promise(resolve => setTimeout(resolve, 1000 * 2**loginAttempts));
        }

        loginAttempts++;
    }
    
    clearInterval(loginLoader);
    process.stdout.clearLine(0);
    process.stdout.write("\r\x1b[32mLogging in: ✓\x1b[0m\n");

    const homeworks = await client.getHomeworks();

    homeworks.sort((a, b) => {
        return b.due - a.due;
    });

    const homeworkOrder = ["HO", "XP", "TA"];
    homeworks.sort((a, b) => {
        const aSlice = a.name.slice(0, 2).toUpperCase();
        const bSlice = b.name.slice(0, 2).toUpperCase();
        
        return homeworkOrder.indexOf(aSlice) - homeworkOrder.indexOf(bSlice);
    });

    // Progress for each homework. Read only: a homework never opened shows as not started.
    const progress = await Promise.all(homeworks.map(homework => client.getHomeworkProgress(homework.id).catch(() => null)));

    console.log('=========================================');
    for (let i = 0; i < homeworks.length; i++) {
        const homework = homeworks[i];
        const p = progress[i];

        if (!p) {
            console.log(`${i + 1}. ${homework.name} (progress unknown)`);
            continue;
        }

        if (!p.started) {
            console.log(`${i + 1}. ${homework.name} (\x1b[31mnot started\x1b[0m)`);
            continue;
        }

        const percentageComplete = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
        const percentageColor = percentageComplete === 100 ? "\x1b[32m" : (percentageComplete >= 50 ? "\x1b[33m" : "\x1b[31m");

        console.log(`${i + 1}. ${homework.name} (${percentageColor}${percentageComplete}%\x1b[0m, ${p.done}/${p.total})`);
    }
    console.log('=========================================');

    let homeworkIndex = null;
    while (homeworkIndex === null) {
        const answer = await getInput("Select number: ");
        if (isNaN(parseInt(answer)) || parseInt(answer) < 1 || parseInt(answer) > homeworks.length) {
            console.log("Invalid number.");
            continue;
        }

        homeworkIndex = parseInt(answer) - 1;
    }

    const homework = homeworks[homeworkIndex];

    console.log(`\nCompleting homework "${homework.name}"...\n`);

    const tasks = await homework.getTasks();

    console.log(`Tasks to complete: ${tasks.length}`);

    // Counts before this run, from the tasks themselves (the homework list does not include them)
    const totalQuestions = tasks.reduce((sum, task) => sum + task.totalAmountOfQuestions, 0);
    const doneBefore = tasks.reduce((sum, task) => sum + task.completedAmountOfQuestions, 0);

    let amountOfTasksCompleted = 0;

    for (let i = 0; i < tasks.length; i++) {
        console.log('\n' + tasks[i].name);

        const taskActivitiesMeta = await tasks[i].getActivities();
        const history = []; // what was submitted in this run, used to answer the bookwork check

        for (let j = 0; j < tasks[i].totalAmountOfQuestions; j++) {
            if (taskActivitiesMeta[j].completed) {
                console.log(`  ${j + 1}. \x1b[32m✓\x1b[0m`);
                continue;
            }

            const loader = loadingAnimation(`  ${j + 1}.`);

            // Solve first, so a failed solve never leaves an item started but unanswered
            let activity, answers;
            try {
                activity = await tasks[i].getActivity(j + 1);
                answers = await activity.getAnswers(j);
            } catch (error) {
                clearInterval(loader);
                process.stdout.write(`\r  ${j + 1}. \x1b[31m×\x1b[0m ${error.message}\n`);
                continue;
            }

            if (!answers) {
                clearInterval(loader);
                process.stdout.write(`\r  ${j + 1}. \x1b[31m×\x1b[0m\n`);
                continue;
            }

            await activity.registerStart();
            const submissionSuccess = await activity.submitAnswers(homework, answers, `${i + 1}${alphabet[j]}`);

            clearInterval(loader);

            // No second attempt with the same model: it would probably repeat the mistake and use up attempts
            if (submissionSuccess) {
                process.stdout.write(`\r  ${j + 1}. \x1b[32m✓\x1b[0m\n`);

                amountOfTasksCompleted++;
                history.push({ itemIndex: j + 1, answers, layout: activity.layout[0] });
            } else {
                process.stdout.write(`\r  ${j + 1}. \x1b[31m×\x1b[0m not marked correct\n`);
            }
        }

        // The bookwork check appears once every item in the task is done
        const bookwork = await client.completeTaskBookwork(homework.id, tasks[i].taskId, history);
        if (bookwork.status !== 'none') {
            console.log(`  Bookwork ${bookwork.code || ''}: ${bookwork.message}`);
        }
    }

    const percentage = (done) => (totalQuestions > 0 ? Math.round((done / totalQuestions) * 100) : 0);
    const oldPercentage = percentage(doneBefore);
    const newPercentage = percentage(doneBefore + amountOfTasksCompleted);

    console.log(`\n\x1b[31m${oldPercentage}% \x1b[0m-> \x1b[32m${newPercentage}%\x1b[0m`);

    await client.logout();

    process.exit(0);
})();
