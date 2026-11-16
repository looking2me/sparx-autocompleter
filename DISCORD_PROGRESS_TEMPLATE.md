# Discord progress post: template

Copy the text inside the template block below. Discord renders the formatting when you paste it.
Replace the `<...>` parts. Remove any section that has nothing to say.

## Template

```md
# <emoji> <Project>: Progress

**Last updated:** <date>

## 🚦 Status
- <🟢 / 🟡 / 🔴 / ⚪> **<Part>:** <working / partly working / broken / untested>, <short detail>

## 🛠️ Changes so far
> <file>: <what changed>

## 🔍 What we found
- <finding>

## ➡️ Next steps
1. <step>
```

## Status key
- 🟢 working and checked
- 🟡 partly working, or not confirmed
- 🔴 broken
- ⚪ untested

## Rules
- Keep each line short. One finding per bullet.
- Don't include passwords, tokens, cookies or the student's name.
- Say what is not verified, rather than marking it working.
- Use the date the post is written.

## Example

```md
# 📘 Sparx Autocompleter: Progress

**Last updated:** 15 Nov 2026

## 🚦 Status
- 🟢 **Login:** working, headless browser
- 🟢 **Homework list:** working, 8 homeworks load with correct due dates
- 🟢 **Opening a question:** working, starts an attempt on the account
- 🟡 **Answer submission:** not confirmed, typing into the answer boxes is unreliable
- 🔴 **Question counts per homework:** not loaded yet, shows 0
- ⚪ **Task and submit functions:** untested, still on the old API

## 🛠️ Changes so far
> `classes/Sparx.js`: browser stays open until logout
> `classes/Sparx.js`: homework list moved to the new API, requests go through the browser

## 🔍 What we found
- The site moved to `api.sparx-learning.com`
- Plain requests get a Cloudflare 403, so requests go through the browser
- A question is one request to load and one to start. The answer format is still unknown

## ➡️ Next steps
1. Check in Sparx whether the test question was answered
2. Capture the answer submission (needs go-ahead, sends a real answer)
3. Rewrite the task and submit functions for the new API
```
