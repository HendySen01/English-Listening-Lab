// Context Reader 的解释合同。静态样本只作对照；真实解析走预览缓存接口。
export const EXPLANATION_SYSTEM_PROMPT = "你是英语词源与语境解析专家。全文中文内容必须使用简体中文，英文例句及词源原文可保留英文。只输出一个严格合法、可被 JSON.parse 解析的 JSON 对象，不要 Markdown、代码围栏、注释或任何额外文字。所有字符串中的双引号和换行必须正确转义。examples 必须正好 2 条，semanticRoutes 必须正好 3 条。格式示例：{\"text\":\"word\",\"type\":\"word\",\"pronunciation\":\"/wɜːd/\",\"partOfSpeech\":\"名词\",\"definition\":\"语境释义\",\"usage\":\"用法\",\"etymology\":{\"prefix\":\"无\",\"root\":\"词根\",\"suffix\":\"无\",\"origin\":\"来源\",\"originalImage\":\"原始画面\",\"certainty\":\"较确定\"},\"semanticRoutes\":[{\"label\":\"线路A\",\"steps\":\"演变过程\",\"modernMeaning\":\"现代义\",\"domain\":\"日常\"},{\"label\":\"线路B\",\"steps\":\"演变过程\",\"modernMeaning\":\"现代义\",\"domain\":\"商业\"},{\"label\":\"线路C\",\"steps\":\"演变过程\",\"modernMeaning\":\"现代义\",\"domain\":\"技术\"}],\"comparisons\":[{\"word\":\"near-synonym\",\"partOfSpeech\":\"名词\",\"difference\":\"区别\"}],\"examples\":[{\"text\":\"Example sentence.\",\"translation\":\"例句译文\",\"contextNote\":\"语境说明\"},{\"text\":\"Another example.\",\"translation\":\"另一例句\",\"contextNote\":\"语境说明\"}]}。必须包含全部字段。"

export function explanationUserPrompt(sentence: string, word: string) {
  return `当前完整句子：${sentence}\n目标词/词组：${word}\n只返回符合 schema 的 JSON。`
}

export const EXPLANATION_CALL = {
  temperature: 0.2,
  maxTokens: 8000,
  responseFormat: "json_object",
  modelNote: "Context Reader 浏览器端默认 Base URL 是 OpenAI 兼容接口，模型由用户填写；其服务端代理把模型固定为 deepseek-flash。Listening Lab 课程生成走自己的 LLM_MODEL。两套任务不共用提示词。",
}

export type Analysis = {
  text: string
  type: "word" | "phrase"
  pronunciation: string
  partOfSpeech: string
  definition: string
  usage: string
  etymology: {
    prefix: string
    root: string
    suffix: string
    origin: string
    originalImage: string
    certainty: string
  }
  semanticRoutes: { label: string; steps: string; modernMeaning: string; domain: string }[]
  comparisons: { word: string; partOfSpeech: string; difference: string }[]
  examples: { text: string; translation: string; contextNote: string }[]
}

export type Passage = { id: string; sentence: string; translation: string; phrases?: string[] }

export const museumSentence = "After hours of driving, we finally found a quiet parking space behind the museum."

export const contextPassages: Passage[] = [
  {
    id: "museum",
    sentence: museumSentence,
    translation: "开了几个小时的车后，我们终于在博物馆后面找到一个安静的停车位。",
    phrases: ["parking space"],
  },
  {
    id: "curious-look",
    sentence: "He gave me a curious look.",
    translation: "他看了我一眼，神情里带着好奇。",
  },
  {
    id: "bus-stop",
    sentence: "Tom waits for the bus with a curious look.",
    translation: "汤姆带着好奇的神情等公共汽车。",
  },
]

export const wordPassages: Passage[] = [
  { id: "word-curious", sentence: "She is curious about the new shop.", translation: "她对那家新店感到好奇。", phrases: [] },
  { id: "word-schedule", sentence: "Tom checks his schedule before leaving home.", translation: "汤姆出门前看了一眼日程。", phrases: [] },
  { id: "word-neighbor", sentence: "A neighbor waits at the same bus stop.", translation: "一位邻居在同一个车站等车。", phrases: [] },
  { id: "word-laundry", sentence: "He will pick up the laundry after work.", translation: "他下班后会去取洗好的衣服。", phrases: [] },
  { id: "word-grocery", sentence: "The grocery store is near the bus stop.", translation: "杂货店就在车站附近。", phrases: [] },
  { id: "word-appointment", sentence: "His appointment is at nine.", translation: "他的预约在九点。", phrases: [] },
]

export const listeningPassages: Passage[] = [
  { id: "listen-0", sentence: "Tom waits for the bus with a curious look.", translation: "汤姆带着好奇的神情等公共汽车。" },
  { id: "listen-1", sentence: "He checks his schedule before the appointment.", translation: "他在预约之前看了日程。" },
  { id: "listen-2", sentence: "A neighbor talks about the grocery store near the laundry.", translation: "一位邻居谈到洗衣店附近的杂货店。" },
]

function entry(partial: Analysis): Analysis {
  return partial
}

const analyses: Record<string, Analysis> = {
  "museum::finally": entry({
    text: "finally", type: "word", pronunciation: "/ˈfaɪnəli/", partOfSpeech: "副词",
    definition: "在这句里，finally 标记一件等了很久的事终于发生：开了几个小时后，停车位找到了。",
    usage: "副词，修饰 found。它放在动词前，强调过程的终点，而不是单纯表示“最后一项”。常见搭配 finally found、finally finished。和 eventually 相比，finally 的等待感更明显。",
    etymology: { prefix: "无", root: "final", suffix: "-ly", origin: "final 来自拉丁语 finalis（处于结束的）。-ly 是英语副词后缀。", originalImage: "一长串事情走到最后一格，事情才落地。", certainty: "较确定" },
    semanticRoutes: [
      { label: "顺序终点", steps: "final 表示最终的，加上 -ly 后用来给动作标出结束。", modernMeaning: "终于、最后", domain: "日常" },
      { label: "松一口气", steps: "长时间等待之后结果出现，语气里常有解脱。", modernMeaning: "总算", domain: "叙事" },
      { label: "收束论点", steps: "在说明文末尾用 finally 引出最后一点。", modernMeaning: "最后", domain: "写作" },
    ],
    comparisons: [
      { word: "eventually", partOfSpeech: "副词", difference: "也是最终发生，但没有 finally 那么强的“等了很久”的感觉。" },
      { word: "at last", partOfSpeech: "短语", difference: "语气更重，常带着不耐烦或明显的放松。" },
    ],
    examples: [
      { text: "She finally finished the book on the train.", translation: "她终于在火车上读完了那本书。", contextNote: "同样是长时间过程之后的结果。" },
      { text: "We finally sat down after the long walk.", translation: "走了很久之后，我们终于坐下了。", contextNote: "动词前的 finally 修饰整个动作。" },
    ],
  }),
  "museum::quiet": entry({
    text: "quiet", type: "word", pronunciation: "/ˈkwaɪət/", partOfSpeech: "形容词",
    definition: "这里的 quiet 形容停车位一带声音小、不吵，不是“人闭口不说话”。",
    usage: "形容词，直接放在 parking space 前面。常见搭配 a quiet street、keep quiet。silent 更接近完全没有声音；calm 多形容情绪或局面平稳。",
    etymology: { prefix: "无", root: "quiet", suffix: "无", origin: "拉丁语 quietus（休息的、平静的），经古法语进入英语。它不是由现代英语前缀和后缀临时拼出来的。", originalImage: "一个地方从喧闹里停下来，处于休息。", certainty: "较确定" },
    semanticRoutes: [
      { label: "环境安静", steps: "从“休息、不再喧闹”扩展到地点的声音很小。", modernMeaning: "安静的", domain: "日常" },
      { label: "少说话", steps: "同一个词也可以要求人压低声音或暂时不说。", modernMeaning: "keep quiet", domain: "日常" },
      { label: "未公开", steps: "商业里 quiet period 指一段不宜公开评论的时期，已经离开“声音小”的字面。", modernMeaning: "低调、静默期", domain: "商业" },
    ],
    comparisons: [
      { word: "silent", partOfSpeech: "形容词", difference: "完全没有声音，比 quiet 更绝对。" },
      { word: "calm", partOfSpeech: "形容词", difference: "强调平稳，不一定指声音。" },
    ],
    examples: [
      { text: "We found a quiet street behind the museum.", translation: "我们在博物馆后面找到了一条安静的街道。", contextNote: "和原句一样，quiet 修饰地点。" },
      { text: "Please keep quiet while the tour starts.", translation: "参观开始时请保持安静。", contextNote: "这里要求人控制声音。" },
    ],
  }),
  "museum::parking space": entry({
    text: "parking space", type: "phrase", pronunciation: "/ˈpɑːrkɪŋ speɪs/", partOfSpeech: "名词短语",
    definition: "供一辆车停放的一个具体位置。这句的结果就是终于找到了这样一个位置。",
    usage: "名词短语，作 found 的宾语。parking 来自动词 park 的 -ing 形式，space 是可用的一块空间。它指一个车位，不是整片停车场。",
    etymology: { prefix: "无", root: "park + space", suffix: "-ing", origin: "park 作“停放车辆”是后起用法；space 指可占用的空间。两者合在一起才专指车位。不要把 parking 拆成无关系的词根。", originalImage: "一大片地面上划出刚好停一辆车的空格。", certainty: "较确定" },
    semanticRoutes: [
      { label: "停放", steps: "park 从园地引申到把车停在某处。", modernMeaning: "停车", domain: "日常" },
      { label: "一个空格", steps: "space 强调可供使用的那一块，而不是整片区域。", modernMeaning: "车位", domain: "日常" },
      { label: "保留位置", steps: "reserved parking space 表示这个格子已经被指定给某人。", modernMeaning: "专用车位", domain: "日常" },
    ],
    comparisons: [
      { word: "parking lot", partOfSpeech: "名词", difference: "整片停车场，能停很多车。" },
      { word: "parking spot", partOfSpeech: "名词短语", difference: "口语里和 parking space 很接近，都指一个车位。" },
    ],
    examples: [
      { text: "We finally found a parking space near the station.", translation: "我们终于在车站附近找到了一个停车位。", contextNote: "found a parking space 是原句的同一搭配。" },
      { text: "This parking space is reserved for residents.", translation: "这个停车位是留给住户的。", contextNote: "space 仍是一个格子，不是整片场地。" },
    ],
  }),
  "museum::behind": entry({
    text: "behind", type: "word", pronunciation: "/bɪˈhaɪnd/", partOfSpeech: "介词",
    definition: "在这句里表示空间位置：车位在博物馆的后面，不是时间上的“之后”。",
    usage: "介词，后面接 the museum。核心是“在某物后侧”。它也可以说进度落后，但这里没有这个意思。",
    etymology: { prefix: "be-", root: "hind", suffix: "无", origin: "古英语 be-（在某处）加上 hindan（后方）。这是历史构词，不是现在还能随意拆开造词的前缀。", originalImage: "站在一座建筑背对街道的那一侧。", certainty: "较确定" },
    semanticRoutes: [
      { label: "空间后方", steps: "最初就是“在后侧”的位置。", modernMeaning: "在……后面", domain: "日常" },
      { label: "进度落后", steps: "从物理位置引申到比别人慢。", modernMeaning: "落后", domain: "学习" },
      { label: "支持", steps: "behind someone 还可以表示站在某人一边。本句不是这个意思。", modernMeaning: "支持", domain: "日常" },
    ],
    comparisons: [
      { word: "after", partOfSpeech: "介词", difference: "主要是时间或顺序上的“之后”。" },
      { word: "in back of", partOfSpeech: "短语", difference: "美式口语里也可以说在某物后面。" },
    ],
    examples: [
      { text: "The café is just behind the old library.", translation: "咖啡馆就在旧图书馆后面。", contextNote: "同样是空间位置。" },
      { text: "She is behind the rest of the class.", translation: "她比班上其他人进度落后。", contextNote: "这是引申义，和博物馆那句不同。" },
    ],
  }),
  "word-curious::curious": entry({
    text: "curious", type: "word", pronunciation: "/ˈkjʊəriəs/", partOfSpeech: "形容词",
    definition: "在这句里，curious 表示她想知道那家新店是什么样，不是“古怪”，也不是把所有字典义并列出来。",
    usage: "形容词作表语，搭配 curious about。about 后面接她想了解的对象。主语是人。若说 a curious machine，才更接近“奇特”。",
    etymology: { prefix: "无", root: "cur-", suffix: "-ous", origin: "拉丁语 curiosus，与 cura（关心、留意）有关。-ous 是形容词后缀。现代英语里不能把 cur 当成还能自由构词的词根来猜生词。", originalImage: "一个人把注意力探向还不知道的事物。", certainty: "较确定" },
    semanticRoutes: [
      { label: "想知道", steps: "从“对某事上心”变成想进一步了解。", modernMeaning: "好奇", domain: "日常" },
      { label: "好奇的神情", steps: "a curious look 把这种心情写在表情上，不一定说出 about。", modernMeaning: "好奇的样子", domain: "叙事" },
      { label: "奇特", steps: "修饰事物时，curious 可以表示不寻常。本句修饰人，不是这条。", modernMeaning: "古怪、罕见", domain: "描写" },
    ],
    comparisons: [
      { word: "interested", partOfSpeech: "形容词", difference: "也是感兴趣，但 curious 更强调还不知道、想弄清。" },
      { word: "nosy", partOfSpeech: "形容词", difference: "带贬义，指打探别人的私事。" },
    ],
    examples: [
      { text: "The child is curious about how the clock works.", translation: "孩子想知道这座钟是怎么运转的。", contextNote: "curious about 后面接想了解的内容。" },
      { text: "She gave the closed door a curious look.", translation: "她好奇地看了那扇关着的门一眼。", contextNote: "这里是神情，和 about 搭配不同。" },
    ],
  }),
  "listen-0::curious": entry({
    text: "curious", type: "word", pronunciation: "/ˈkjʊəriəs/", partOfSpeech: "形容词",
    definition: "这里的 curious 修饰 look，表示汤姆脸上的神情是想知道什么，不是说他这个人性格古怪。",
    usage: "形容词作定语，a curious look。句子没有 about，所以好奇的对象要靠上下文，不能自动补成 curious about the bus。",
    etymology: { prefix: "无", root: "cur-", suffix: "-ous", origin: "拉丁语 curiosus，与 cura（关心）有关。历史来源可靠，但不能据此把每个含 cur 的词都解释成好奇。", originalImage: "目光停在一件还没看明白的东西上。", certainty: "较确定" },
    semanticRoutes: [
      { label: "神情", steps: "look 是表情，curious 说明那种表情带着探问。", modernMeaning: "好奇的神情", domain: "叙事" },
      { label: "想了解", steps: "若换成 curious about，对象会明确说出来。", modernMeaning: "对某事好奇", domain: "日常" },
      { label: "奇特", steps: "修饰物品时才常表示古怪。本句修饰 look，不取这条。", modernMeaning: "奇特", domain: "描写" },
    ],
    comparisons: [
      { word: "puzzled", partOfSpeech: "形容词", difference: "puzzled 偏困惑，curious 偏想继续了解。" },
      { word: "interested", partOfSpeech: "形容词", difference: "interested look 更中性，好奇的探问感更弱。" },
    ],
    examples: [
      { text: "He waited with a curious look.", translation: "他带着好奇的神情等待。", contextNote: "和原句同一结构。" },
      { text: "She is curious about the new shop.", translation: "她对那家新店感到好奇。", contextNote: "这是 about 搭配，和 a curious look 不是同一句型。" },
    ],
  }),
  "word-schedule::schedule": entry({
    text: "schedule", type: "word", pronunciation: "/ˈskedʒuːl/", partOfSpeech: "名词",
    definition: "汤姆出门前查看的那份安排：今天要做的事和时间。这里是名词，不是动词“安排”。",
    usage: "check his schedule 是查看自己的日程。美式读音常见 /ˈskedʒuːl/。它和 calendar 不同，calendar 更偏日期本身。",
    etymology: { prefix: "无", root: "无可靠的现代英语词根", suffix: "无", origin: "拉丁语 schedula，是 scheda（纸条、纸片）的指小形式，后来经法语进入英语，从“一张清单”变成“时间安排”。不能把开头的 sch 当成表示安排的词根。", originalImage: "一张写着待办事项的纸条。", certainty: "较确定" },
    semanticRoutes: [
      { label: "纸条", steps: "早期指一小张书写用的纸。", modernMeaning: "清单", domain: "历史" },
      { label: "时间表", steps: "纸上的项目被排进时间，变成日程。", modernMeaning: "日程、时刻表", domain: "日常" },
      { label: "安排动作", steps: "现代英语里 schedule 也可以作动词，表示把事情排进去。本句是名词。", modernMeaning: "安排", domain: "工作" },
    ],
    comparisons: [
      { word: "timetable", partOfSpeech: "名词", difference: "更常用于课程或车次这种固定表格。" },
      { word: "agenda", partOfSpeech: "名词", difference: "多指会议要讨论的事项，不一定是一整天的安排。" },
    ],
    examples: [
      { text: "Tom checks his schedule before leaving home.", translation: "汤姆出门前看了一眼日程。", contextNote: "check a schedule 是查看，不是制定。" },
      { text: "The bus schedule changed on Monday.", translation: "公共汽车时刻表星期一改了。", contextNote: "这里是对外公布的时刻表。" },
    ],
  }),
  "listen-1::schedule": entry({
    text: "schedule", type: "word", pronunciation: "/ˈskedʒuːl/", partOfSpeech: "名词",
    definition: "他在赴约前查看的日程，用来确认时间和顺序。",
    usage: "checks his schedule 中 schedule 是名词宾语。before the appointment 说明查看的原因是后面还有约定。",
    etymology: { prefix: "无", root: "无可靠的现代英语词根", suffix: "无", origin: "拉丁语 schedula（小纸片）后来表示清单和时间安排。历史词源不等于现在可以把单词拆成 sch + edule。", originalImage: "一张用来核对先后顺序的清单。", certainty: "较确定" },
    semanticRoutes: [
      { label: "个人日程", steps: "his schedule 指他自己的安排。", modernMeaning: "日程", domain: "日常" },
      { label: "时刻表", steps: "公共交通的 schedule 是对外的时间表。", modernMeaning: "时刻表", domain: "出行" },
      { label: "动词用法", steps: "schedule a meeting 是把会议排进去。本句不是动词。", modernMeaning: "安排", domain: "工作" },
    ],
    comparisons: [
      { word: "plan", partOfSpeech: "名词", difference: "plan 可以很笼统，schedule 通常带有时间顺序。" },
      { word: "appointment", partOfSpeech: "名词", difference: "appointment 是其中的一个约定，schedule 是整份安排。" },
    ],
    examples: [
      { text: "He checks his schedule before the appointment.", translation: "他在预约之前看了日程。", contextNote: "查看在先，约定在后。" },
      { text: "I scheduled the visit for nine.", translation: "我把这次拜访排在九点。", contextNote: "这是动词，和原句词性不同。" },
    ],
  }),
  "listen-1::appointment": entry({
    text: "appointment", type: "word", pronunciation: "/əˈpɔɪntmənt/", partOfSpeech: "名词",
    definition: "事先约好的一次见面或办事时间。这句里它是 schedule 之后要去的那一件事。",
    usage: "the appointment 指已经存在的那次约定。常见搭配 have an appointment、a dental appointment。appoint 作动词是指定或约定，名词才是这次见面。",
    etymology: { prefix: "ap-", root: "point", suffix: "-ment", origin: "来自法语 appointer，字面是“指向某个点”，引申为指定时间和人选。-ment 把动作变成名词。ap- 是拉丁语 ad- 在 p 前的形式，不是单独表示预约的现代前缀。", originalImage: "在时间上点出一个双方都要到场的点。", certainty: "较确定" },
    semanticRoutes: [
      { label: "约定时间", steps: "把一次见面固定到某个时间。", modernMeaning: "预约、约会", domain: "日常" },
      { label: "任命", steps: "appoint 也可以是指定某人担任职位。", modernMeaning: "任命", domain: "工作" },
      { label: "医疗就诊", steps: "看医生时 appointment 就是挂号的那个时间。", modernMeaning: "就诊预约", domain: "生活" },
    ],
    comparisons: [
      { word: "meeting", partOfSpeech: "名词", difference: "meeting 偏多人讨论，appointment 常是一对一、事先订好的。" },
      { word: "date", partOfSpeech: "名词", difference: "date 可以是社交约会，appointment 更中性，常是事务。" },
    ],
    examples: [
      { text: "His appointment is at nine.", translation: "他的预约在九点。", contextNote: "点出约定的钟点。" },
      { text: "She has a dental appointment on Friday.", translation: "她星期五约了看牙。", contextNote: "have an appointment 是拥有这次约定。" },
    ],
  }),
  "word-appointment::appointment": entry({
    text: "appointment", type: "word", pronunciation: "/əˈpɔɪntmənt/", partOfSpeech: "名词",
    definition: "九点那次已经约好的见面。句子只告诉时间，没有说是看病还是办事。",
    usage: "His appointment is at nine 用 at 接钟点。不要把 appointment 理解成“任命”，除非上下文在说职位。",
    etymology: { prefix: "ap-", root: "point", suffix: "-ment", origin: "法语 appointer，原意接近“指向、指定”。-ment 构成名词。", originalImage: "日历上被点中的一个钟点。", certainty: "较确定" },
    semanticRoutes: [
      { label: "约好的时间", steps: "双方同意在某一刻见面。", modernMeaning: "预约", domain: "日常" },
      { label: "职位任命", steps: "同一词族也可以表示委派职务。本句只有钟点，不取这条。", modernMeaning: "任命", domain: "工作" },
      { label: "就医", steps: "如果上下文是诊所，它就是就诊时间。本句没有这个信息。", modernMeaning: "就诊", domain: "生活" },
    ],
    comparisons: [
      { word: "reservation", partOfSpeech: "名词", difference: "reservation 多是订位，如餐厅或车票，不一定是和人见面。" },
      { word: "schedule", partOfSpeech: "名词", difference: "schedule 是整份安排，appointment 是其中一次约定。" },
    ],
    examples: [
      { text: "His appointment is at nine.", translation: "他的预约在九点。", contextNote: "at 用来接具体钟点。" },
      { text: "I need to make an appointment.", translation: "我需要预约一次。", contextNote: "make an appointment 是把约定建立起来。" },
    ],
  }),
}

for (const [id, lemma, text] of [
  ["word-neighbor", "neighbor", "住在附近的人。这句里就是和汤姆在同一车站等车的那一位，不是泛指所有附近的人。"],
  ["listen-2::neighbor", "neighbor", "说话的人是住在附近的人。talks about 后面才是话题，不是 neighbor 的意思。"],
] as const) {
  const key = id.includes("::") ? id : `${id}::${lemma}`
  analyses[key] = entry({
    text: lemma, type: "word", pronunciation: "/ˈneɪbər/", partOfSpeech: "名词",
    definition: text,
    usage: "可数名词。美式拼写 neighbor，英式拼写 neighbour。a neighbor 是其中一位。next-door neighbor 才强调隔壁。",
    etymology: { prefix: "无", root: "无可靠的现代英语词根", suffix: "无", origin: "古英语 nēahgebūr，大致是“附近的居住者”。现代拼写里的 -or 不是一个可以单独拿走的动作后缀。", originalImage: "住得很近、会在同一条街上遇见的人。", certainty: "较确定" },
    semanticRoutes: [
      { label: "附近居民", steps: "从“近处的居住者”固定成邻居。", modernMeaning: "邻居", domain: "日常" },
      { label: "隔壁", steps: "next-door 把范围收到紧邻的那一户。", modernMeaning: "隔壁邻居", domain: "日常" },
      { label: "邻近国家", steps: "neighbor 也可以指邻国，那是引申，本句是人。", modernMeaning: "邻国", domain: "新闻" },
    ],
    comparisons: [
      { word: "roommate", partOfSpeech: "名词", difference: "住在同一套房子里的人，不一定是邻居关系。" },
      { word: "stranger", partOfSpeech: "名词", difference: "不认识的人。邻居可能认识，也可能只是住得近。" },
    ],
    examples: [
      { text: "A neighbor waits at the same bus stop.", translation: "一位邻居在同一个车站等车。", contextNote: "a neighbor 只确定有一位，没有说姓名。" },
      { text: "Our next-door neighbor waters the plants.", translation: "我们的隔壁邻居给植物浇水。", contextNote: "next-door 把位置说得更具体。" },
    ],
  })
}

analyses["word-laundry::laundry"] = entry({
  text: "laundry", type: "word", pronunciation: "/ˈlɔːndri/", partOfSpeech: "名词",
  definition: "这句的 laundry 是要取回的那些衣物。pick up the laundry 通常指去取洗好的衣服，不一定是洗衣店这个地方。",
  usage: "不可数时指衣物这一批。do the laundry 是洗衣服。a laundry 才更像洗衣店。原句用 the laundry，配合 pick up，优先理解为那批衣服。",
  etymology: { prefix: "无", root: "无可靠的现代英语词根", suffix: "无", origin: "与拉丁语 lavare（洗）有关，经古法语进入英语。不能把 laundry 拆成 laun + dry。", originalImage: "洗完、叠好、等待取回的一堆衣服。", certainty: "较确定" },
  semanticRoutes: [
    { label: "待洗衣物", steps: "词义落在那批衣服上。", modernMeaning: "要洗或洗好的衣服", domain: "日常" },
    { label: "洗衣这件事", steps: "do the laundry 把名词用成一项家务。", modernMeaning: "洗衣服", domain: "日常" },
    { label: "洗衣店", steps: "前面加 a 或 the，并配合地点动词时，可以指店铺。", modernMeaning: "洗衣店", domain: "日常" },
  ],
  comparisons: [
    { word: "clothes", partOfSpeech: "名词", difference: "所有衣服。laundry 专指这一批要洗或已洗的。" },
    { word: "dry cleaning", partOfSpeech: "名词", difference: "干洗，处理方式不同。" },
  ],
  examples: [
    { text: "He will pick up the laundry after work.", translation: "他下班后会去取洗好的衣服。", contextNote: "pick up 支持“取衣服”这个理解。" },
    { text: "I do the laundry on Sunday.", translation: "我星期天洗衣服。", contextNote: "这里是家务，不是取衣服。" },
  ],
})

analyses["listen-2::laundry"] = analyses["word-laundry::laundry"]
analyses["word-grocery::grocery"] = entry({
  text: "grocery", type: "word", pronunciation: "/ˈɡroʊsəri/", partOfSpeech: "名词",
  definition: "grocery store 是卖食品和日用小商品的店。这句只说它在车站附近。",
  usage: "常与 store 连用。groceries 复数多指买回来的那些食品。不要把 grocery 单独理解成“一家餐厅”。",
  etymology: { prefix: "无", root: "无可靠的现代英语词根", suffix: "无", origin: "与古法语 grosserie（批发的货物）有关。现代读者不需要把它拆成 gro + cery。", originalImage: "货架上成批摆着的食品和日用品。", certainty: "较确定" },
  semanticRoutes: [
    { label: "杂货店", steps: "grocery store 固定成卖食品杂货的店。", modernMeaning: "杂货店", domain: "日常" },
    { label: "买到的食品", steps: "groceries 指采购来的那些东西。", modernMeaning: "食品杂货", domain: "日常" },
    { label: "批发旧义", steps: "词源里的 gross 与“批量”有关，不是现在句中的意思。", modernMeaning: "批量货物", domain: "历史" },
  ],
  comparisons: [
    { word: "supermarket", partOfSpeech: "名词", difference: "规模通常更大，grocery store 可以是街角小店。" },
    { word: "market", partOfSpeech: "名词", difference: "market 可以是市场，范围比 grocery store 宽。" },
  ],
  examples: [
    { text: "The grocery store is near the bus stop.", translation: "杂货店就在车站附近。", contextNote: "store 把词义确定为店铺。" },
    { text: "She carried two bags of groceries.", translation: "她拎着两袋食品杂货。", contextNote: "复数 groceries 是物品，不是店。" },
  ],
})
analyses["listen-2::grocery"] = analyses["word-grocery::grocery"]
analyses["word-neighbor::neighbor"] = analyses["word-neighbor::neighbor"]

export function cacheKey(passageId: string, word: string) {
  return `${passageId}::${word.trim().toLowerCase()}`
}

export function lookupAnalysis(passageId: string, word: string) {
  return analyses[cacheKey(passageId, word)] || null
}

export function tokenize(sentence: string, phrases: string[] = []) {
  const tokens: { text: string; key: string }[] = []
  const sorted = phrases.map((item) => item.toLowerCase()).sort((a, b) => b.length - a.length)
  let rest = sentence
  while (rest) {
    const lower = rest.toLowerCase()
    const phrase = sorted.find((item) => lower.startsWith(item))
    if (phrase) {
      tokens.push({ text: rest.slice(0, phrase.length), key: phrase })
      rest = rest.slice(phrase.length)
      continue
    }
    const word = /^[A-Za-z]+(?:['’-][A-Za-z]+)*/.exec(rest)
    if (word) {
      tokens.push({ text: word[0], key: word[0].toLowerCase() })
      rest = rest.slice(word[0].length)
      continue
    }
    const other = /^[^A-Za-z]+/.exec(rest)
    tokens.push({ text: other ? other[0] : rest[0], key: "" })
    rest = rest.slice(other ? other[0].length : 1)
  }
  return tokens
}

export function validateAnalysis(raw: unknown) {
  const errors: string[] = []
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null
  if (!source) return { ok: false, errors: ["解析结果必须是 JSON 对象"] }
  for (const field of ["text", "type", "pronunciation", "partOfSpeech", "definition", "usage"]) {
    if (typeof source[field] !== "string" || !String(source[field]).trim()) errors.push(`${field} 不能为空`)
  }
  if (source.type !== "word" && source.type !== "phrase") errors.push("type 必须是 word 或 phrase")
  const etymology = source.etymology
  if (!etymology || typeof etymology !== "object" || Array.isArray(etymology)) errors.push("etymology 必须是对象")
  else {
    for (const field of ["origin", "originalImage"]) {
      if (typeof (etymology as Record<string, unknown>)[field] !== "string") errors.push(`etymology.${field} 必须是字符串`)
    }
  }
  if (!Array.isArray(source.semanticRoutes) || source.semanticRoutes.length < 1) errors.push("semanticRoutes 至少需要一项")
  if (!Array.isArray(source.examples) || source.examples.length < 1) errors.push("examples 至少需要一项")
  if (JSON.stringify(source).includes("语境占位说明")) errors.push("解析结果包含语境占位说明，不能作为成功解析")
  return { ok: errors.length === 0, errors }
}
