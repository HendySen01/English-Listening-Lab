export type PreviewWord = {
  lemma: string;
  pos: string;
  meaning: string;
  definition: string;
  example: string;
  exampleZh: string;
  collocation: string;
  stress: string;
  simpler: string;
  morphology: string;
};

export const previewLesson = {
  title: "A Morning on the Bus",
  theme: "Daily Life",
  level: "CET-4",
  minutes: 60,
  source: "AI 课程",
  step: "新词",
  stepIndex: 2,
  stepTotal: 6,
};

export const previewWords: PreviewWord[] = [
  {
    lemma: "schedule",
    pos: "noun",
    meaning: "日程",
    definition: "a plan of things you will do",
    example: "Tom checks his schedule before leaving home.",
    exampleZh: "汤姆出门前看了一眼日程。",
    collocation: "check a schedule",
    stress: "第一个音节重读",
    simpler: "Tom looks at his schedule.",
    morphology: "词根 sch 与「安排」无关。这里只记 schedule = 日程。",
  },
  {
    lemma: "curious",
    pos: "adjective",
    meaning: "好奇的",
    definition: "wanting to know more",
    example: "She is curious about the new shop.",
    exampleZh: "她对那家新店感到好奇。",
    collocation: "curious about",
    stress: "第一个音节重读",
    simpler: "She is curious about the shop.",
    morphology: "词根 cur 表示关心。curious 是对一件事想知道更多。",
  },
  {
    lemma: "neighbor",
    pos: "noun",
    meaning: "邻居",
    definition: "a person who lives near you",
    example: "A neighbor waits at the same bus stop.",
    exampleZh: "一位邻居在同一个车站等车。",
    collocation: "a next-door neighbor",
    stress: "第一个音节重读",
    simpler: "A neighbor waits for the bus.",
    morphology: "日常拼写用 neighbor。意思就是住在附近的人。",
  },
  {
    lemma: "laundry",
    pos: "noun",
    meaning: "待洗的衣物",
    definition: "clothes that need washing",
    example: "He will pick up the laundry after work.",
    exampleZh: "他下班后会去取洗好的衣服。",
    collocation: "do the laundry",
    stress: "第一个音节重读",
    simpler: "He picks up the laundry.",
    morphology: "laundry 既可以指衣服，也可以指洗衣店。",
  },
  {
    lemma: "grocery",
    pos: "noun",
    meaning: "食品杂货",
    definition: "food and small household goods",
    example: "The grocery store is near the bus stop.",
    exampleZh: "杂货店就在车站附近。",
    collocation: "a grocery store",
    stress: "第一个音节重读",
    simpler: "The grocery store is near here.",
    morphology: "grocery 常和 store 连用，表示杂货店。",
  },
  {
    lemma: "appointment",
    pos: "noun",
    meaning: "预约",
    definition: "a time you agreed to meet someone",
    example: "His appointment is at nine.",
    exampleZh: "他的预约在九点。",
    collocation: "have an appointment",
    stress: "第二个音节重读",
    simpler: "His appointment is at nine.",
    morphology: "appoint 是指定，appointment 是约好的见面时间。",
  },
];

export const previewSentences = [
  "Tom waits for the bus with a curious look.",
  "He checks his schedule before the appointment.",
  "A neighbor talks about the grocery store near the laundry.",
];

export const glosses: Record<string, { meaning: string; definition: string; state: string }> = {
  tom: { meaning: "汤姆", definition: "a person's name", state: "已认识" },
  waits: { meaning: "等待", definition: "stays until something happens", state: "已认识" },
  for: { meaning: "为了；等待", definition: "used after wait", state: "已认识" },
  the: { meaning: "这个", definition: "a common article", state: "已认识" },
  bus: { meaning: "公共汽车", definition: "a large vehicle for many people", state: "已认识" },
  with: { meaning: "带着", definition: "having something", state: "已认识" },
  a: { meaning: "一个", definition: "a common article", state: "已认识" },
  curious: { meaning: "好奇的", definition: "wanting to know more", state: "待学习" },
  look: { meaning: "表情", definition: "the way someone's face appears", state: "已认识" },
  he: { meaning: "他", definition: "a pronoun", state: "已认识" },
  checks: { meaning: "查看", definition: "looks at something to confirm it", state: "已认识" },
  his: { meaning: "他的", definition: "belonging to him", state: "已认识" },
  schedule: { meaning: "日程", definition: "a plan of things to do", state: "重点" },
  before: { meaning: "在……之前", definition: "earlier than", state: "已认识" },
  appointment: { meaning: "预约", definition: "a planned meeting time", state: "待学习" },
  neighbor: { meaning: "邻居", definition: "a person who lives near you", state: "待学习" },
  talks: { meaning: "交谈", definition: "speaks with someone", state: "已认识" },
  about: { meaning: "关于", definition: "on the subject of", state: "已认识" },
  grocery: { meaning: "食品杂货", definition: "food sold in a small shop", state: "待学习" },
  store: { meaning: "商店", definition: "a shop", state: "已认识" },
  near: { meaning: "在附近", definition: "close to", state: "已认识" },
  laundry: { meaning: "待洗的衣物", definition: "clothes that need washing", state: "重点" },
};

export const reviewSamples = [
  { lemma: "appointment", meaning: "预约", due: "已逾期 43 分钟" },
  { lemma: "grocery", meaning: "杂货", due: "已逾期 18 分钟" },
  { lemma: "laundry", meaning: "洗衣", due: "还有 2 小时" },
];

export const week = [
  { label: "一", minutes: 40 },
  { label: "二", minutes: 55 },
  { label: "三", minutes: 25 },
  { label: "四", minutes: 60 },
  { label: "五", minutes: 35 },
  { label: "六", minutes: 50 },
  { label: "日", minutes: 20 },
];
