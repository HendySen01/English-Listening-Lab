import { BANK } from "./bank.js";
import enUS from "./pronunciation/en-US.json" with { type: "json" };

const curated = new Map(BANK.map(word => [word.lemma.toLowerCase(), word.ipa]));
const american = new Map(enUS as [string, string][]);
// Cambridge Dictionary, US pronunciation. The open dictionary also includes a variant.
curated.set("enjoy", "/ɪnˈdʒɔɪ/");

export function vocabularyIpa(lemma: string, saved?: string | null) {
  if (saved) return saved;
  const key = lemma.trim().toLowerCase();
  return curated.get(key) ?? american.get(key) ?? null;
}
