export const grades = [
  { id:"again", label:"忘记" }, { id:"hard", label:"困难" },
  { id:"good", label:"记得" }, { id:"easy", label:"非常熟悉" },
] as const;
export type Grade = typeof grades[number]["id"];
export function intervalLabel(item: { intervalMinutes?: Partial<Record<Grade,number>>; intervals?: Partial<Record<Grade,number>> | null }, grade: Grade) {
  const minutes = item.intervalMinutes?.[grade];
  if (typeof minutes === "number" && Number.isFinite(minutes) && minutes >= 0) {
    if (minutes < 1) return "不足 1 分钟";
    if (minutes < 60) return `${Math.round(minutes)} 分钟`;
    if (minutes < 1440) return `约 ${Math.round(minutes / 60 * 10) / 10} 小时`;
    return `约 ${Math.round(minutes / 1440 * 10) / 10} 天`;
  }
  const days = item.intervals?.[grade];
  return typeof days === "number" ? (days === 0 ? "不足一天" : `约 ${days} 天`) : "评分后安排";
}
