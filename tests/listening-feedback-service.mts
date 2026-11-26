import assert from "node:assert/strict";
import { learnerDb } from "../apps/server/src/runtimeClients.ts";
import { disconnectUserPrisma } from "../apps/server/src/userDatabase.ts";
import { readListeningFeedback, submitListeningFeedback } from "../apps/server/src/learnerListeningFeedback.ts";
import { ownQuota } from "../apps/server/src/learnerQuota.ts";
import { AppError } from "../apps/server/src/errors.ts";

assert.equal(process.env.CI, "true");
assert.equal(process.env.POSTGRES_RUNTIME, "0");
assert.match(process.env.USER_DATABASE_URL || "", /\/data\/user-runtime-listening-ci\.db$/);
assert.equal(process.env.AI_REAL_CALLS, "0");
const db = learnerDb();
const originalFetch = globalThis.fetch;
let calls = 0;
let mode: "ok" | "invalid" | "network" = "ok";
const transcript = "She politely refused his offer. We schedule a meeting.";
const valid = { understanding: "accurate", comprehension: { en: "You understood the main events.", zh: "你理解了主要事件。" }, language: { en: "Use refused.", zh: "使用 refused。" }, naturalVersion: { en: "She refused the offer.", zh: "她拒绝了提议。" }, evidence: ["She politely refused his offer."] };
const learner = (id: string) => ({learnerId:id,authUserId:"auth-"+id,boundAt:new Date()});
const a = learner("fixture-a"), b = learner("fixture-b");
const code = (name: string) => (e: unknown) => e instanceof AppError && e.code === name;
const progress = { step:"listening", generation:{direction:"cet6"}, listening:{round:1,firstGist:""}, shadow:{index:2,marks:[]} };
async function seed(who: typeof a) {
  await db.learner.create({data:{id:who.learnerId,authUserId:who.authUserId,boundAt:who.boundAt,createdAt:new Date()}});
  await db.dailyLesson.create({data:{id:"lesson-"+who.learnerId,userId:who.learnerId,lessonDate:"2026-11-25",version:1,active:true,theme:"Daily Life",difficulty:"B1",newWordCount:0,estimatedMinutes:60,source:"offline",poolNote:"fixture",progress:JSON.stringify(progress),listeningTitle:"Fixture",listeningText:transcript,listeningChunks:JSON.stringify([transcript]),listeningGloss:"{}",createdAt:new Date()}});
}
try {
  await seed(a); await seed(b);
  // Intercept all provider traffic before enabling the real request path. No network passthrough.
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input),"https://listening-fixture.invalid/chat/completions");
    calls++;
    const body=JSON.parse(String(init?.body));
    const data=JSON.parse(body.messages[1].content);
    assert.equal(data.transcript,transcript);
    assert.ok(data.learnerAnswer.length);
    if(mode==="network")throw Error("fixture network failure");
    return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(mode==="invalid"?{...valid,evidence:["Invented quotation"]}:valid)}}]});
  };
  process.env.DEEPSEEK_BASE_URL="https://listening-fixture.invalid";
  process.env.DEEPSEEK_API_KEY="fixture-key-not-real";
  process.env.DEEPSEEK_MODEL="deepseek-flash";
  process.env.AI_REAL_CALLS="1";
  const id="lesson-"+a.learnerId;
  const answer="She refuse the offer.";
  await assert.rejects(()=>submitListeningFeedback(b,id,answer,true),code("NOT_FOUND"));
  await assert.rejects(()=>readListeningFeedback(b,id),code("NOT_FOUND"));
  await assert.rejects(()=>submitListeningFeedback(a,id,"中文",true),code("BAD_ANSWER"));
  await assert.rejects(()=>submitListeningFeedback(a,id,answer,false),code("AI_CONFIRMATION_REQUIRED"));
  assert.equal(calls,0);
  assert.equal((await ownQuota(a)).userUsed,0);
  const first=await submitListeningFeedback(a,id,answer,true);
  assert.equal(first.feedback.understanding,"accurate");
  assert.equal(first.charged,true);
  assert.equal((await readListeningFeedback(a,id)).source,"cache");
  const repeat=await submitListeningFeedback(a,id,answer,true);
  assert.equal(repeat.charged,false);
  assert.deepEqual(repeat.feedback,first.feedback);
  assert.equal(calls,1);
  assert.equal((await ownQuota(a)).userUsed,1);
  assert.equal((await ownQuota(b)).userUsed,0);
  const saved=JSON.parse((await db.dailyLesson.findUniqueOrThrow({where:{id}})).progress);
  assert.equal(saved.listening.firstGist,answer);
  assert.deepEqual(saved.generation,progress.generation);
  assert.deepEqual(saved.shadow,progress.shadow);
  mode="invalid";
  const revised="She refused his offer.";
  await assert.rejects(()=>submitListeningFeedback(a,id,revised,true),code("AI_RESPONSE_REJECTED"));
  assert.equal((await readListeningFeedback(a,id)).answer,revised);
  assert.equal((await readListeningFeedback(a,id)).feedback,null);
  assert.equal((await ownQuota(a)).userUsed,2);
  mode="ok";
  assert.equal((await submitListeningFeedback(a,id,revised,true)).charged,true);
  assert.equal(calls,3);
  mode="network";
  const another="She said no.";
  await assert.rejects(()=>submitListeningFeedback(a,id,another,true),code("AI_CONNECTION"));
  await assert.rejects(()=>submitListeningFeedback(a,id,another,true),code("AI_PENDING"));
  assert.equal(calls,4);
  assert.equal((await readListeningFeedback(a,id)).answer,another);
  assert.equal((await ownQuota(a)).userUsed,4);
  assert.equal((await readListeningFeedback(b,"lesson-"+b.learnerId)).answer,"");
  console.log("Listening feedback service: ownership, validation, cache, charges, failure retention and unknown-request protection passed.");
} finally {
  process.env.AI_REAL_CALLS="0";
  globalThis.fetch=originalFetch;
  await disconnectUserPrisma();
}
