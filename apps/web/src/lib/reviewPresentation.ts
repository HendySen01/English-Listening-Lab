export const grades = [
  { id:"again", label:"忘记" }, { id:"hard", label:"困难" },
  { id:"good", label:"记得" }, { id:"easy", label:"非常熟悉" },
] as const;
export type Grade = typeof grades[number]["id"];
export function reviewStateLabel(state: number | undefined) {
  return ({0:"新学",1:"学习中",2:"长期复习",3:"重新学习"} as Record<number,string>)[state ?? -1] || "阶段未记录";
}
// Preserve the scheduler's actual intervals. Round only to the nearest minute.
export function formatIntervalMinutes(value: number) {
  if (!Number.isFinite(value) || value < 0) return "评分后安排";
  if (value < 1) return "不足 1 分钟";
  const minutes = Math.round(value);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes % 1440 / 60);
  const rest = minutes % 60;
  return [days ? days+" 天" : "", hours ? hours+" 小时" : "", rest ? rest+" 分钟" : ""].filter(Boolean).join(" ");
}
export function intervalLabel(item: { intervalMinutes?: Partial<Record<Grade,number>>; intervals?: Partial<Record<Grade,number>> | null }, grade: Grade) {
  const minutes = item.intervalMinutes?.[grade];
  if (typeof minutes === "number" && Number.isFinite(minutes) && minutes >= 0) {
    return formatIntervalMinutes(minutes);
  }
  const days = item.intervals?.[grade];
  return typeof days === "number" ? (days === 0 ? "不足一天" : `约 ${days} 天`) : "评分后安排";
}
