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
  let feedbackPosts = 0, savedFeedback = null, translationPosts=0;
  let roundFourAttempts=0, shadowTransitionAttempts=0;
  const recallAnswer="She refused the offer. We arranged a meeting.";
  const gistAnswer = "She refuse an offer and we arrange a meeting.";
  const feedback = {
    understanding: "accurate",
    comprehension: { en: "You understood the main events.", zh: "你理解了主要事件。" },
    language: { en: "Use refused instead of refuse.", zh: "用 refused 替换 refuse。" },
    naturalVersion: { en: "She refused an offer and we arranged a meeting.", zh: "她拒绝了提议，我们安排了一场会议。" },
    evidence: ["She politely refused his offer."],
  };
  const lesson = {
    id: "fixture-lesson", lessonDate: "2026-11-25", version: 1, active: true,
    theme: "Daily Life", themeLabel: "日常生活", difficulty: "B1", learningDirection: "cet6",
    newWordCount: 2, estimatedMinutes: 60, source: "offline", sourceLabel: "测试课程", poolNote: "",
    progress: { step: "review", completed: [], wordIndex: 0, listening: { round: 1, firstGist: "", thirdGist: "", recall: "", recallNote: "", recallMode: "" }, shadow: { index: 0, marks: [] } },
    listening: { title: "A morning at work", text: "She politely refused his offer. We schedule a meeting.", chunks: ["She politely refused his offer.", "We schedule a meeting."], gloss: {}, translations:[{index:0,sentence:"She politely refused his offer.",translation:"她礼貌地拒绝了他的提议。"}] },
    words: [structuredClone(politely),structuredClone(schedule)], questions: [{id:"fixture-quiz",kind:"context",prompt:"What does politely mean?",options:["In a respectful way","Very loudly","Tomorrow"],answered:false,selected:null,correct:null,answerIndex:null,explanationEn:null,explanationZh:null,evidence:null,whyWrong:null}],
  };
  const settings = { colorMode: mode, speechRate: 1.2, wordPartsEnabled: true };
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const method = route.request().method(), p = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    if (p === "/api/user-runtime/health") return json({ ok: false }, 404);
    if (p === "/api/dashboard") return json({ dateLabel: "2026-11-25", settings, lesson });
    if (p === "/api/system") return json({ ok: true, ttsUsable: false });
    if (p === "/api/settings" && method === "PUT") { Object.assign(settings, route.request().postDataJSON()); return json(settings); }
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
    if (p === "/api/lessons/fixture-lesson/translations" && method === "POST") {
      assert.equal(route.request().postDataJSON().confirmCost,true);
      translationPosts++;
      lesson.listening.translations=[...lesson.listening.translations,{index:1,sentence:"We schedule a meeting.",translation:"我们安排一场会议。"}];
      return json({translations:lesson.listening.translations,charged:true});
    }
    if (p === "/api/lessons/fixture-lesson/listening-feedback" && method === "GET") {
      const answer = lesson.progress.listening.firstGist;
      return json({ answer, feedback: savedFeedback?.answer === answer ? savedFeedback.feedback : null, source: savedFeedback?.answer === answer ? "cache" : "none" });
    }
    if (p === "/api/lessons/fixture-lesson/listening-feedback" && method === "POST") {
      const body = route.request().postDataJSON();
      assert.equal(body.confirmCost, true);
      assert.equal(body.answer, gistAnswer);
      feedbackPosts++;
      lesson.progress.listening.firstGist = body.answer;
      await new Promise(resolve => setTimeout(resolve, 350));
      if (feedbackPosts === 1) return json({ error: "测试：批改暂时失败，答案已保留。" }, 502);
      savedFeedback = { answer: body.answer, feedback, model: "fixture" };
      return json({ ...savedFeedback, source: "live", charged: true });
    }
    if (p === "/api/lessons/fixture-lesson/progress" && method === "PATCH") {
      const next=route.request().postDataJSON().progress;
      // Reproduce a delayed or failed save on the exact transition that lost the user's input.
      if(next.step==="listening" && next.listening.round===4 && lesson.progress.listening.round===3){
        roundFourAttempts++;
        await new Promise(resolve=>setTimeout(resolve,600));
        if(roundFourAttempts===1)return json({error:"测试：听力阶段未保存"},503);
      }
      if(next.step==="shadow" && lesson.progress.step==="listening"){
        shadowTransitionAttempts++;
        assert.equal(next.listening.recall,recallAnswer,"Retelling must survive the progress transition");
        await new Promise(resolve=>setTimeout(resolve,350));
        if(shadowTransitionAttempts===1)return json({error:"测试：英文回忆未保存"},503);
      }
      lesson.progress = next; return json(lesson);
    }
    if (p === "/api/review" && method === "GET") return json({ items: reviews, dueCount: reviews.length });
    if (p.startsWith("/api/review/") && p.endsWith("/rate")) {
      const body = route.request().postDataJSON();
      requestIds.push(body.clientRequestId);
      attempts += 1;
      if (attempts === 1) return json({ error: "测试：评分未保存" }, 503);
      reviews = reviews.filter(word => !p.includes(word.id));
      for(const word of lesson.words)if(p.includes(word.id)){word.reps++;word.lastReview=new Date().toISOString();}
      return json({ ok: true, due: "2026-11-26T00:00:00.000Z" });
    }
    if (p === "/api/preview/explain" && method === "GET") {
      return json(url.searchParams.get("word") === "politely" && url.searchParams.get("sentence") === politely.example
        ? { analysis: fixtureAnalysis, source: "cache" } : { source: "miss" });
    }
    if (p === "/api/preview/explain" && method === "POST") { explainPosts++; return json({ error: "No paid calls in UI test" }, 403); }
    if(p==="/api/quiz/fixture-quiz/answer" && method==="POST"){const q=lesson.questions[0];Object.assign(q,{answered:true,selected:route.request().postDataJSON().selected,correct:true,answerIndex:0,explanationEn:"It describes a respectful manner.",explanationZh:"它描述礼貌的方式。",evidence:"She politely refused his offer.",whyWrong:["","Not loudness.","Not time."]});return json({ok:true});}
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
    await page.locator(".parts-study").waitFor();
    assert.deepEqual(lesson.progress.completed,[], "Free navigation cannot mark a stage completed");
    const parts = page.locator(".parts-study");
    await parts.getByRole("heading", { name: "词源与构词" }).waitFor();
    await parts.getByText("测试原始画面", { exact: true }).waitFor();
    assert.equal(explainPosts, 0, "Existing cached explanation must not request a model");
    assert.equal(await parts.getByRole("button", { name: "我已认识" }).count(), 0, "Parts page must not show non-wired marks");
    await page.screenshot({ path: output + "/" + name + "-parts.png", fullPage: true });
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(dimensions.scroll <= dimensions.width + 2, "Unexpected horizontal overflow: " + JSON.stringify(dimensions));
    await page.getByRole("button", { name: "5 跟读", exact: true }).click();
    const speeds = page.getByRole("group", { name: "语速", exact: true });
    await speeds.waitFor();
    assert.equal(await speeds.getByRole("button").count(), 3);
    assert.equal(await speeds.getByRole("button", { name: "1.3× 快速" }).getAttribute("aria-pressed"), "true");
    await speeds.getByRole("button", { name: "0.7× 慢速" }).click();
    await page.waitForFunction(() => document.querySelector('.speed-control button[aria-pressed="true"]')?.getAttribute("aria-label") === "0.7× 慢速" && !document.querySelector('.speed-control button:disabled'));
    assert.equal(settings.speechRate, 0.7);
    await page.getByRole("button", { name: "4 听力", exact: true }).click();
    await speeds.waitFor();
    assert.equal(await speeds.getByRole("button", { name: "0.7× 慢速" }).getAttribute("aria-pressed"), "true");
    await page.reload();
    await speeds.waitFor();
    assert.equal(await speeds.getByRole("button", { name: "0.7× 慢速" }).getAttribute("aria-pressed"), "true");
    const gist = page.locator(".gist-card");
    const answer = gist.getByRole("textbox", { name: "Your summary" });
    await answer.waitFor();
    await page.waitForFunction(() => !document.querySelector("#listening-gist-answer")?.disabled);
    assert.equal(await gist.getByRole("button", { name: "提交 AI 批改" }).isDisabled(), true);
    await answer.fill(gistAnswer);
    await gist.getByRole("button", { name: "提交 AI 批改" }).click();
    const grading = gist.getByRole("button", { name: "正在批改…" });
    await grading.waitFor();
    assert.equal(await grading.isDisabled(), true);
    await grading.evaluate(button => button.click());
    await gist.getByRole("alert").waitFor();
    assert.equal(await answer.inputValue(), gistAnswer);
    assert.equal(feedbackPosts, 1);
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#listening-gist-answer")?.value === "She refuse an offer and we arrange a meeting." && !document.querySelector("#listening-gist-answer")?.disabled);
    await gist.getByRole("button", { name: "提交 AI 批改" }).click();
    await gist.getByRole("heading", { name: "You understood the main idea" }).waitFor();
    assert.equal(feedbackPosts, 2);
    assert.equal(await gist.locator(".rd-trans-text.is-blurred").count(), 3);
    const firstFeedback = gist.locator(".gist-section").first();
    await firstFeedback.getByRole("button", { name: "显示翻译" }).click();
    assert.equal(await firstFeedback.locator(".rd-trans-text.is-blurred").count(), 0);
    assert.equal(await gist.locator(".rd-trans-text.is-blurred").count(), 2);
    await firstFeedback.getByRole("button", { name: "隐藏翻译" }).click();
    await page.screenshot({ path: output + "/" + name + "-listening-feedback.png", fullPage: true });
    await page.reload();
    await gist.getByRole("heading", { name: "You understood the main idea" }).waitFor();
    assert.equal(await answer.inputValue(), gistAnswer);
    assert.equal(await gist.locator(".rd-trans-text.is-blurred").count(), 3);
    assert.equal(await gist.getByRole("button", { name: "已完成批改" }).isDisabled(), true);
    assert.equal(feedbackPosts, 2, "Restoring feedback must not POST again");
    await gist.getByRole("button", { name: "对照原文 →" }).click();
    await page.getByRole("button", { name: "2 原文", exact: true }).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some(b => b.textContent.trim() === "2 原文" && b.getAttribute("aria-pressed") === "true"));
    const transcript=page.locator(".transcript-sentence");
    await transcript.first().locator(".rd-trans-text.is-blurred").waitFor();
    assert.equal(translationPosts,0);
    await page.getByRole("button",{name:"补齐中文译文",exact:true}).click();
    await transcript.nth(1).locator(".rd-trans-text.is-blurred").waitFor();
    assert.equal(translationPosts,1);
    await page.goto(origin+"/context?lesson=fixture-lesson");
    const reading=page.locator(".rd-read");
    await reading.locator(".rd-trans-text.is-blurred").waitFor();
    await reading.getByRole("button",{name:"显示翻译",exact:true}).click();
    assert.equal(await reading.locator(".rd-trans-text").textContent(),"她礼貌地拒绝了他的提议。");
    await reading.getByRole("button",{name:"下一句",exact:true}).click();
    await reading.locator(".rd-trans-text.is-blurred").waitFor();
    assert.equal(await reading.locator(".rd-trans-text").textContent(),"我们安排一场会议。");
    assert.equal(translationPosts,1);
    await page.screenshot({path:output+"/"+name+"-context-translations.png",fullPage:true});
    await page.goto(origin+"/lesson/fixture-lesson");
    // Complete each stage through its own explicit continuation, not through tab visits.
    await page.getByRole("button",{name:"1 复习",exact:true}).click();
    await card.getByRole("heading",{name:"schedule",exact:true}).waitFor();
    await card.getByRole("button",{name:"显示答案",exact:true}).click();
    await card.getByRole("button",{name:/记得/}).click();
    await page.getByRole("button",{name:"开始新词",exact:true}).click();
    await page.getByRole("button",{name:"下一个",exact:true}).click();
    await page.getByRole("button",{name:"完成新词，继续 →",exact:true}).click();
    await parts.getByRole("button",{name:"进入听力",exact:true}).click();
    await page.getByRole("button",{name:"原文已读，开始再听 →",exact:true}).click();
    const advanceRecall=page.getByRole("button",{name:"再听结束，尝试回忆 →",exact:true});
    const recallInput=page.getByPlaceholder("Retell the passage in English…");
    const saveRecall=page.getByRole("button",{name:"保存英文回忆，进入跟读 →",exact:true});
    await advanceRecall.click();
    assert.equal(await recallInput.count(),0,"Do not mount next-stage input while progress is saving");
    await page.getByRole("alert").getByText("测试：听力阶段未保存",{exact:true}).waitFor();
    assert.equal(lesson.progress.listening.round,3);
    assert.equal(await recallInput.count(),0,"Failed save must not advance");
    await advanceRecall.click();
    await recallInput.waitFor();
    assert.equal(lesson.progress.listening.round,4);
    await recallInput.fill(recallAnswer);
    await saveRecall.click();
    await page.getByRole("alert").getByText("测试：英文回忆未保存",{exact:true}).waitFor();
    assert.equal(await recallInput.inputValue(),recallAnswer,"Failed save must preserve retelling");
    assert.equal(lesson.progress.step,"listening");
    await saveRecall.click();
    await page.locator(".shadow-study").waitFor();
    assert.equal(lesson.progress.listening.recall,recallAnswer);
    assert.equal(roundFourAttempts,2);
    assert.equal(shadowTransitionAttempts,2);
    await page.locator(".shadow-study").getByRole("button",{name:"跟上了",exact:true}).click();
    await page.locator(".shadow-study").getByText("第 2 / 2 句",{exact:true}).waitFor();
    await page.locator(".shadow-study").getByRole("button",{name:"没跟上",exact:true}).click();
    await page.getByRole("button",{name:"去做回忆和测验",exact:true}).click();
    await card.getByRole("heading",{name:"politely",exact:true}).waitFor();
    await card.getByRole("button",{name:"显示答案",exact:true}).click();
    await card.getByRole("button",{name:/记得/}).click();
    await page.getByRole("button",{name:"In a respectful way",exact:true}).click();
    await page.getByRole("button",{name:"完成本课回忆",exact:true}).click();
    await page.getByRole("heading",{name:"本课学习完成",exact:true}).waitFor();
    assert.equal(new Set(lesson.progress.completed).size,6);
    await page.reload();
    await page.getByRole("heading",{name:"本课学习完成",exact:true}).waitFor();
    await page.screenshot({path:output+"/"+name+"-course-complete.png",fullPage:true});
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
    console.log(name + ": review, word formation, shared speeds, listening feedback, delayed and failed progress saves, six-stage course, and course generation passed");
  } catch (error) {
    await page.screenshot({ path: output + "/" + name + "-failure.png", fullPage: true }).catch(() => {});
    throw error;
  } finally { await browser.close(); }
}

await verify(chromium, "chromium-desktop-light", { width: 1440, height: 900 }, "light");
await verify(chromium, "chromium-mobile-dark", { width: 390, height: 844 }, "dark");
await verify(webkit, "webkit-mobile-light", { width: 390, height: 844 }, "light");
console.log("Mock route UI checks complete. Modern WebKit is not iOS 15.6 real-device verification.");
