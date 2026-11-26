export function formatDue(due: string | Date, now = new Date()) {
  const target = new Date(due).getTime();
  if (!Number.isFinite(target)) return "时间无效";
  const diff = target - now.getTime();
  const abs = Math.abs(diff);
  const minutes = Math.max(1, Math.round(abs / 60000));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (diff <= 0 && diff > -60_000) return "现在可以复习";
  if (diff > 0 && diff < 60_000) return "不足 1 分钟";
  if (diff < 0) {
    if (days >= 1) return `已逾期 ${days} 天 ${hours % 24} 小时`;
    if (hours >= 1) return `已逾期 ${hours} 小时 ${minutes % 60} 分钟`;
    return `已逾期 ${minutes} 分钟`;
  }
  if (hours < 1) return `剩余 ${minutes} 分钟`;
  if (days < 1) return `剩余 ${hours} 小时 ${minutes % 60} 分钟`;
  return `剩余 ${days} 天 ${hours % 24} 小时`;
}

export function formatWhen(value: string | Date | null) {
  if (!value) return "还没有复习记录";
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day} ${hour}:${minute}`;
}
