// Local fixture only: browser intercepts every API and blocks non-local network.
// No production DB, session, keys, or real model/audio requests.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const directory = process.env.PLAYWRIGHT_DIR;
if (!directory) throw new Error("Set PLAYWRIGHT_DIR to the isolated Playwright installation");
const { chromium, webkit } = await import(pathToFileURL(path.join(directory, "node_modules/playwright/index.mjs")).href);
const origin = "http://127.0.0.1:5173";
const output = "ui-results";
await mkdir(output, { recursive: true });

const makeWord = (id, lemma, meaningZh, example, exampleZh, morphology = null) => ({
  id, lemma, pos: "verb", ipa: "/ˈprɑːmɪs/", ipaNote: "", stress: null,
  meaningZh, definitionEn: "A fixture definition.", collocation: "",
  example, exampleZh, morphology, knownAlready: false, familiarity: "new",
  reps: 0, due: "2026-11-25T03:00:00.000Z", lastReview: null,
  lapses: 0, state: 0, correctCount: 0, incorrectCount: 0,
  intervals: { again: 0, hard: 0, good: 0, easy: 1 },
  intervalMinutes: { again: 1, hard: 6, good: 10, easy: 1440 },
});
const promise = makeWord("fixture-promise", "promise", "承诺，答应", "I promise to send the file tonight.", "我承诺今晚发送文件。");
const schedule = makeWord("fixture-schedule", "schedule", "安排", "We schedule a meeting.", "我们安排一场会议。");
const politely = {
  ...makeWord("fixture-politely", "politely", "礼貌地", "She politely refused his offer.", "她礼貌地拒绝了他的提议。", {
    prefix: null, root: "polite", suffix: "-ly", meaningZh: "描述行为方式。", example: "She politely refused his offer.",
  }), pos: "adverb", ipa: "/pəˈlaɪtli/",
};
const fixtureAnalysis = {
  text: "politely", type: "word", pronunciation: politely.ipa, partOfSpeech: "adverb",
  definition: "礼貌地", usage: "修饰 refused，描述拒绝的方式。",
  etymology: { prefix: "", root: "polite", suffix: "-ly", origin: "测试词源", originalImage: "测试原始画面", certainty: "测试" },
  semanticRoutes: [{ label: "测试线路", domain: "日常", steps: "测试语义过程", modernMeaning: "礼貌地" }],
  comparisons: [],
  examples: [{ text: "She spoke politely.", translation: "她礼貌地说话。", contextNote: "测试例句" }],
};

async function verify(engine, name, viewport, mode) {
  const browser = await engine.launch();
  const context = await browser.newContext({ viewport, colorScheme: mode, reducedMotion: "reduce", serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = [], unexpected = [];
  page.on("pageerror", error => errors.push(error.message));
  let reviews = [promise, schedule], attempts = 0, explainPosts = 0, generations = 0, dialogs = 0;
  page.on("dialog", async dialog => { dialogs++; await dialog.dismiss(); });
  const requestIds = [];
  const lesson = {
    id: "fixture-lesson", lessonDate: "2026-11-25", version: 1, active: true,
    theme: "Daily Life", themeLabel: "日常生活", difficulty: "B1", learningDirection: "cet6",
    newWordCount: 2, estimatedMinutes: 60, source: "offline", sourceLabel: "测试课程", poolNote: "",
    progress: { step: "review", completed: [], wordIndex: 0, listening: { round: 1, firstGist: "", thirdGist: "", recall: "", recallNote: "", recallMode: "" }, shadow: { index: 0, marks: [] } },
    listening: { title: "A morning at work", text: "She politely refused his offer. We schedule a meeting.", chunks: ["She politely refused his offer.", "We schedule a meeting."], gloss: {} },
    words: [politely, schedule], questions: [],
  };
  const settings = { colorMode: mode, speechRate: 1, wordPartsEnabled: true };
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const method = route.request().method(), p = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    if (p === "/api/user-runtime/health") return json({ ok: false }, 404);
    if (p === "/api/dashboard") return json({ dateLabel: "2026-11-25", settings, lesson });
    if (p === "/api/system") return json({ ok: true, ttsUsable: false });
    if (p === "/api/lessons/ai-version" && method === "POST") {
      generations++;
      const body = route.request().postDataJSON();
      assert.equal(body.confirmCost, true);
      assert.ok(body.clientRequestId);
      await new Promise(resolve => setTimeout(resolve, 700));
      if (generations === 1) return json({ error: "测试：生成暂时失败" }, 502);
      lesson.listening.title = "A new fixture course";
      return json(lesson);
    }
    if (p === "/api/lessons/today/versions") return json([lesson]);
    if (p === "/api/lessons/fixture-lesson" && method === "GET") return json(lesson);
    if (p === "/api/lessons/fixture-lesson/progress" && method === "PATCH") {
      lesson.progress = route.request().postDataJSON().progress; return json(lesson);
    }
    if (p === "/api/review" && method === "GET") return json({ items: reviews, dueCount: reviews.length });
    if (p.startsWith("/api/review/") && p.endsWith("/rate")) {
      const body = route.request().postDataJSON();
      requestIds.push(body.clientRequestId);
      attempts += 1;
      if (attempts === 1) return json({ error: "测试：评分未保存" }, 503);
      reviews = reviews.filter(word => !p.includes(word.id));
      return json({ ok: true, due: "2026-11-26T00:00:00.000Z" });
    }
    if (p === "/api/preview/explain" && method === "GET") {
      return json(url.searchParams.get("word") === "politely" && url.searchParams.get("sentence") === politely.example
        ? { analysis: fixtureAnalysis, source: "cache" } : { source: "miss" });
    }
    if (p === "/api/preview/explain" && method === "POST") { explainPosts++; return json({ error: "No paid calls in UI test" }, 403); }
    if (p === "/api/sessions") return json({ ok: true });
    unexpected.push(method + " " + p);
    return json({ error: "Unhandled fixture endpoint" }, 404);
  });
  try {
    await page.goto(origin + "/lesson/fixture-lesson");
    const card = page.locator(".review-study");
    await card.getByRole("heading", { name: "promise", exact: true }).waitFor();
    assert.equal(await card.getByRole("group", { name: "记忆评分" }).count(), 0, "Ratings must be hidden before reveal");
    await card.getByRole("button", { name: "显示答案", exact: true }).click();
    const translation = card.locator(".rd-trans-text");
    assert.match(await translation.getAttribute("class"), /is-blurred/);
    await card.getByRole("button", { name: "显示翻译", exact: true }).click();
    assert.doesNotMatch(await translation.getAttribute("class"), /is-blurred/);
    await card.getByRole("button", { name: "隐藏翻译", exact: true }).click();
    assert.match(await translation.getAttribute("class"), /is-blurred/);
    await card.getByText("10 分钟", { exact: true }).waitFor();
    await page.screenshot({ path: output + "/" + name + "-review.png", fullPage: true });
    await card.getByRole("button", { name: /记得/ }).click();
    await card.getByRole("alert").getByText("测试：评分未保存").waitFor();
    await card.getByRole("heading", { name: "promise", exact: true }).waitFor();
    await card.getByRole("button", { name: /记得/ }).click();
    await card.getByRole("heading", { name: "schedule", exact: true }).waitFor();
    assert.ok(requestIds[0] && requestIds[0] === requestIds[1], "Failed same-payload retry should keep request ID");
    assert.equal(await card.getByRole("group", { name: "记忆评分" }).count(), 0, "New word must hide answer");
    await page.getByRole("button", { name: "3 词根", exact: true }).click();
    const parts = page.locator(".parts-study");
    await parts.getByRole("heading", { name: "词源与构词" }).waitFor();
    await parts.getByText("测试原始画面", { exact: true }).waitFor();
    assert.equal(explainPosts, 0, "Existing cached explanation must not request a model");
    assert.equal(await parts.getByRole("button", { name: "我已认识" }).count(), 0, "Parts page must not show non-wired marks");
    await page.screenshot({ path: output + "/" + name + "-parts.png", fullPage: true });
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(dimensions.scroll <= dimensions.width + 2, "Unexpected horizontal overflow: " + JSON.stringify(dimensions));
    const generate = page.getByRole("button", { name: "重新生成课程", exact: true });
    await generate.click();
    const busy = page.getByRole("button", { name: "正在生成…", exact: true });
    await busy.waitFor();
    assert.equal(await busy.isDisabled(), true, "Generation must block duplicate clicks");
    await busy.evaluate(button => button.click());
    await page.getByText("测试：生成暂时失败", { exact: true }).waitFor();
    await page.getByRole("heading", { name: "A morning at work", exact: true }).waitFor();
    assert.equal(generations, 1);
    await generate.click();
    await page.getByRole("heading", { name: "A new fixture course", exact: true }).waitFor();
    assert.equal(generations, 2);
    assert.equal(dialogs, 0, "Generation must not open a native confirmation dialog");
    assert.deepEqual(errors, [], "Browser errors");
    assert.deepEqual(unexpected, [], "Unhandled mock requests");
    console.log(name + ": review and cached word formation passed");
  } catch (error) {
    await page.screenshot({ path: output + "/" + name + "-failure.png", fullPage: true }).catch(() => {});
    throw error;
  } finally { await browser.close(); }
}

await verify(chromium, "chromium-desktop-light", { width: 1440, height: 900 }, "light");
await verify(chromium, "chromium-mobile-dark", { width: 390, height: 844 }, "dark");
await verify(webkit, "webkit-mobile-light", { width: 390, height: 844 }, "light");
console.log("Mock route UI checks complete. Modern WebKit is not iOS 15.6 real-device verification.");
