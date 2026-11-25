import type { Lesson } from "../stores/app";

const labels: Record<string, string> = {
  general: "日常英语", highSchool: "高中英语", cet4: "CET-4", cet6: "CET-6",
  postgraduate: "考研英语", ielts: "IELTS", toefl: "TOEFL", business: "商务英语", custom: "自定义学习目标",
};

export function lessonMetadata(lesson: Pick<Lesson, "difficulty" | "theme" | "themeLabel" | "newWordCount" | "estimatedMinutes" | "learningDirection">) {
  const direction = lesson.learningDirection ?? (lesson.difficulty === "CET-4" ? "cet4" : "");
  const level = lesson.difficulty === "CET-4" ? "B1" : lesson.difficulty;
  return [
    labels[direction] ?? "学习方向未记录",
    level,
    lesson.themeLabel || lesson.theme,
    `${lesson.newWordCount} 个新词`,
    Number.isFinite(lesson.estimatedMinutes) ? `约 ${lesson.estimatedMinutes} 分钟` : "",
  ].filter(Boolean).join(" · ");
}
