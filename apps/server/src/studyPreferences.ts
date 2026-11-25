import { AppError } from "./errors.js";
import { normalizeSpeechRate } from "./speechRates.js";

export const cefrLevels = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

export const directionGuidance = {
  general: "Everyday vocabulary, natural conversation, practical situations and gist questions.",
  highSchool: "School and social topics, common academic words, clear sentence patterns and reading inference.",
  cet4: "CET-4-inspired core vocabulary, campus situations, main idea and detail questions.",
  cet6: "CET-6-inspired formal vocabulary, academic and social topics, inference and viewpoint questions.",
  postgraduate: "Postgraduate exam-inspired analytical prose, argument structure, paraphrase and inference.",
  ielts: "IELTS-inspired everyday and academic contexts, paraphrase, speaker attitude and detail questions.",
  toefl: "TOEFL-inspired campus conversations and lectures, academic language, purpose and organization questions.",
  business: "Workplace scenarios, email and meeting language, decisions, actions and tone.",
  custom: "Choose original practice material that fits the learner's stated goal.",
} as const;

type Direction = keyof typeof directionGuidance;
type Preferences = { difficulty: string; listeningLevel: string; learningDirection?: string | null; customLearningGoal?: string | null; speechRate?: number | null };

function isDirection(value: unknown): value is Direction {
  return typeof value === "string" && Object.hasOwn(directionGuidance, value);
}

function level(value: unknown) {
  if (value === "A2+") return "A2";
  if (value === "B1+" || value === "CET-4") return "B1";
  return cefrLevels.find((item) => item === value);
}

function goal(value: unknown) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 160) : "";
}

export function studyPreferences<T extends Preferences>(settings: T) {
  return {
    ...settings,
    speechRate: normalizeSpeechRate(settings.speechRate),
    difficulty: level(settings.difficulty) || "A2",
    listeningLevel: level(settings.listeningLevel) || "match",
    learningDirection: isDirection(settings.learningDirection) ? settings.learningDirection
      : settings.difficulty === "CET-4" || settings.listeningLevel === "CET-4" ? "cet4" : "general",
    customLearningGoal: goal(settings.customLearningGoal),
  };
}

export function updateStudyPreferences(current: Preferences, input: Record<string, unknown>) {
  const saved = studyPreferences(current);
  const learningDirection = isDirection(input.learningDirection) ? input.learningDirection
    : input.difficulty === "CET-4" ? "cet4" : saved.learningDirection;
  const customLearningGoal = input.customLearningGoal === undefined ? saved.customLearningGoal : goal(input.customLearningGoal);
  if (learningDirection === "custom" && !customLearningGoal) {
    throw new AppError(400, "LEARNING_GOAL_REQUIRED", "请填写自定义学习目标。");
  }
  return {
    learningDirection, customLearningGoal,
    difficulty: level(input.difficulty) || saved.difficulty,
    listeningLevel: input.listeningLevel === "match" ? "match" : level(input.listeningLevel) || saved.listeningLevel,
  };
}

export function lessonLearningGoal(settings: Preferences) {
  const preference = studyPreferences(settings);
  return {
    direction: preference.learningDirection,
    material: directionGuidance[preference.learningDirection],
    customGoal: preference.learningDirection === "custom" ? preference.customLearningGoal : undefined,
  };
}
