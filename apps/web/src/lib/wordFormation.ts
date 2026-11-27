type PartKind = "prefix" | "base" | "suffix"
type WordPart = { kind: PartKind; text: string; explanationEn?: string }
export type WordFormation = { parts: WordPart[]; definitionEn: string }
type LegacyMorphology = { prefix?: string | null; root?: string | null; suffix?: string | null }

const labels = { prefix: "前缀", base: "词基 / 词根", suffix: "后缀" }

export function formationLabel(kind: PartKind) {
  return labels[kind]
}

export function formationText({ kind, text }: WordPart) {
  if (kind === "prefix") return text + "-"
  if (kind === "suffix") return "-" + text
  return text
}

export function legacyWordFormation(lemma: string, morphology: LegacyMorphology | null, definitionEn: string): WordFormation {
  if (lemma.toLowerCase() === "briefly") {
    return {
      parts: [
        { kind: "base", text: "brief", explanationEn: "Short in time or length." },
        { kind: "suffix", text: "ly", explanationEn: "Forms an adverb that describes how something is done." },
      ],
      definitionEn: "In a short or concise way.",
    }
  }
  const original: [PartKind, string | null | undefined][] = [
    ["prefix", morphology?.prefix], ["base", morphology?.root], ["suffix", morphology?.suffix],
  ]
  const parts = original.flatMap(([kind, raw]) => {
    const text = raw?.trim().replace(/^-|-$/g, "") || ""
    return /^[a-z]+$/i.test(text) && !isEmptyPart(text) ? [{ kind, text }] : []
  })
  const complete = parts.length > 1 && parts.some(part => part.kind === "base")
    && parts.map(part => part.text).join("").toLowerCase() === lemma.toLowerCase().replaceAll("-", "")
  return { parts: complete ? parts : [], definitionEn }
}

export function isEmptyPart(value: string) {
  return /^(?:无(?:前缀|词根|词基|后缀)?|没有(?:前缀|词根|词基|后缀)?|不适用|待核实|none|no (?:prefix|root|suffix)|n\/?a|null|[-—–]+)?$/i.test(value.trim())
}
