// 学习日是上海日历字符串。FSRS、会话和数据库 DateTime 仍使用绝对时间。
import { AppError } from "./errors.js";

export const defaultStudyTimeZone = "Asia/Shanghai";

let studyClock: Date | null = null;

export function setStudyClock(value: Date | null) {
  studyClock = value ? new Date(value.getTime()) : null;
}

export function studyNow() {
  return studyClock ? new Date(studyClock.getTime()) : new Date();
}

export function readStudyTimeZone(value = process.env.STUDY_TIMEZONE) {
  const zone = (value ?? defaultStudyTimeZone).trim() || defaultStudyTimeZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date(0));
  } catch {
    throw new AppError(500, "BAD_STUDY_TIMEZONE", "STUDY_TIMEZONE 不是有效的 IANA 时区。");
  }
  return zone;
}

type CalendarParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  ms: number;
};

function calendarParts(instant: Date, timeZone: string): CalendarParts {
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    fractionalSecondDigits: 3,
  });
  const values = Object.fromEntries(format.formatToParts(instant).map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    ms: Number(values.fractionalSecond ?? "0"),
  };
}

function isoFromParts(parts: Pick<CalendarParts, "year" | "month" | "day">) {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function studyDate(instant = studyNow(), timeZone = readStudyTimeZone()) {
  return isoFromParts(calendarParts(instant, readStudyTimeZone(timeZone)));
}

export function addStudyDays(iso: string, days: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new AppError(400, "BAD_STUDY_DATE", "学习日格式不正确。");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return isoFromParts({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
}

function zoneOffsetMs(instant: Date, timeZone: string) {
  const parts = calendarParts(instant, timeZone);
  const wallClock = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.ms);
  return wallClock - instant.getTime();
}

function startOfStudyDay(iso: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new AppError(400, "BAD_STUDY_DATE", "学习日格式不正确。");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  let utc = Date.UTC(year, month - 1, day);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const next = Date.UTC(year, month - 1, day) - zoneOffsetMs(new Date(utc), timeZone);
    if (next === utc) break;
    utc = next;
  }
  const start = new Date(utc);
  if (studyDate(start, timeZone) !== iso) {
    throw new AppError(500, "BAD_STUDY_TIMEZONE", "无法确定学习日的开始时间。");
  }
  return start;
}

export function studyDayBounds(iso: string, timeZone = readStudyTimeZone()) {
  const zone = readStudyTimeZone(timeZone);
  const start = startOfStudyDay(iso, zone);
  const end = startOfStudyDay(addStudyDays(iso, 1), zone);
  return { start, end };
}

export function sameStudyDay(left: Date, right: Date, timeZone = readStudyTimeZone()) {
  const zone = readStudyTimeZone(timeZone);
  return studyDate(left, zone) === studyDate(right, zone);
}
