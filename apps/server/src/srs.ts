import { createEmptyCard, fsrs, Rating, type Card } from "ts-fsrs";

const scheduler = fsrs();

export type StoredCard = {
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview: Date | null;
};

export const RATINGS = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
} as const;

export type RatingName = keyof typeof RATINGS;

export function emptyCard(now = new Date()): StoredCard {
  return fromCard(createEmptyCard(now));
}

export function schedule(card: StoredCard, rating: RatingName, now = new Date()) {
  const next = scheduler.next(toCard(card), now, RATINGS[rating]);
  return fromCard(next.card);
}

export function previewDays(card: StoredCard, now = new Date()) {
  const preview = scheduler.repeat(toCard(card), now);
  const days = (due: Date) => Math.max(0, Math.round((due.getTime() - now.getTime()) / 86400000));
  return {
    again: days(preview[Rating.Again].card.due),
    hard: days(preview[Rating.Hard].card.due),
    good: days(preview[Rating.Good].card.due),
    easy: days(preview[Rating.Easy].card.due),
  };
}

export function previewMinutes(card: StoredCard, now = new Date()) {
  const preview = scheduler.repeat(toCard(card), now);
  const minutes = (due: Date) => Math.max(0, (due.getTime() - now.getTime()) / 60000);
  return {
    again: minutes(preview[Rating.Again].card.due), hard: minutes(preview[Rating.Hard].card.due),
    good: minutes(preview[Rating.Good].card.due), easy: minutes(preview[Rating.Easy].card.due),
  };
}

function fromCard(card: Card): StoredCard {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.last_review ?? null,
  };
}

function toCard(card: StoredCard): Card {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    learning_steps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.lastReview ?? undefined,
  };
}
