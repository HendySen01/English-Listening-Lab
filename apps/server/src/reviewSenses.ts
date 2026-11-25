import type { learnerDb } from "./runtimeClients.js";

type ReviewDb = Pick<ReturnType<typeof learnerDb>, "wordProgress">;
type Sense = { lemma: string; pos: string; meaningZh: string; definitionEn: string };

export function senseKey(word: Sense) {
  const parts = [word.lemma, word.pos, word.meaningZh, word.definitionEn]
    .map((value) => value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " "));
  return JSON.stringify(parts);
}

export function reviewRows(db: ReviewDb, userId: string) {
  return db.wordProgress.findMany({ where: { userId, vocabulary: { userId } }, include: { vocabulary: true } });
}

type Row = Awaited<ReturnType<typeof reviewRows>>[number];

export function reviewState(row: Row) {
  const {
    due, stability, difficulty, elapsedDays, scheduledDays, learningSteps, reps, lapses, state,
    lastReview, correctCount, incorrectCount, familiarity, recallAbility,
  } = row;
  return {
    due, stability, difficulty, elapsedDays, scheduledDays, learningSteps, reps, lapses, state,
    lastReview, correctCount, incorrectCount, familiarity, recallAbility,
  };
}

function pristine(row: Row) {
  return !row.reps && !row.lastReview && !row.correctCount && !row.incorrectCount
    && !row.lapses && row.state === 0 && !row.vocabulary.knownAlready && row.familiarity === "new";
}

export function reviewGroups(rows: Row[]) {
  const senses = new Map<string, Row[]>();
  for (const row of rows) {
    const key = senseKey(row.vocabulary);
    const existing = senses.get(key);
    if (existing) existing.push(row);
    else senses.set(key, [row]);
  }
  return [...senses.values()].flatMap((rows) => {
    const histories = new Map<string, Row[]>();
    const fresh: Row[] = [];
    for (const row of rows.sort((a, b) => a.firstLearnedAt.getTime() - b.firstLearnedAt.getTime()
      || a.vocabularyId.localeCompare(b.vocabularyId))) {
      if (pristine(row)) {
        fresh.push(row);
        continue;
      }
      const history = JSON.stringify([row.vocabulary.knownAlready, reviewState(row)]);
      const group = histories.get(history);
      if (group) group.push(row);
      else histories.set(history, [row]);
    }
    const groups = [...histories.values()];
    // A fresh context can follow an unambiguous existing schedule. Keep conflicting histories visible.
    if (fresh.length) {
      if (groups.length === 1) groups[0].push(...fresh);
      else groups.push(fresh);
    }
    return groups;
  });
}
