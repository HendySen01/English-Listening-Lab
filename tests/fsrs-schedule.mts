import assert from "node:assert/strict";
import { emptyCard,schedule,previewMinutes } from "../apps/server/src/srs.ts";
import { formatIntervalMinutes,intervalLabel,reviewStateLabel } from "../apps/web/src/lib/reviewPresentation.ts";
import { formatDue } from "../apps/web/src/lib/due.ts";

const start=new Date("2026-11-27T00:00:00Z");
let card=emptyCard(start),now=start;
const intervals:number[]=[];
for(let i=0;i<12;i++){
  const choices=previewMinutes(card,now);
  const next=schedule(card,"good",now);
  assert.equal((next.due.getTime()-now.getTime())/60000,choices.good);
  assert.equal(next.reps,i+1);
  assert.ok(next.due>now);
  intervals.push(choices.good);
  card=next;now=next.due;
}
assert.ok(intervals.at(-1)!>intervals[0]*10,"Successful spaced recall must grow long-term intervals");
assert.ok(intervals.at(-1)!>=7*1440,"Expected long-term review within twelve successful due-date reviews");
const prior=card;
const lapse=schedule(card,"again",now);
assert.ok(lapse.lapses>prior.lapses);
assert.ok(lapse.due.getTime()-now.getTime()<intervals.at(-1)!*60000,"Forgetting should shorten the interval");
const good=schedule(emptyCard(start),"good",start),easy=schedule(emptyCard(start),"easy",start);
assert.notEqual(good.stability,easy.stability);
assert.equal(formatIntervalMinutes(1440),"1 天");
assert.equal(formatIntervalMinutes(1500),"1 天 1 小时");
assert.equal(formatIntervalMinutes(1441),"1 天 1 分钟");
assert.equal(formatIntervalMinutes(59.8),"1 小时");
assert.equal(intervalLabel({intervalMinutes:{good:10},intervals:{good:0}},"good"),"10 分钟");
assert.equal(reviewStateLabel(2),"长期复习");
assert.equal(formatDue(new Date(start.getTime()+30000),start),"不足 1 分钟");
assert.equal(formatDue(start,start),"现在可以复习");
console.log("FSRS due-date good intervals in minutes:",JSON.stringify(intervals));
console.log("FSRS progression, lapse, preview parity and display passed");
