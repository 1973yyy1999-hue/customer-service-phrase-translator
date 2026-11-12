"use strict";

const builtinLanguages = { en: "英语", ja: "日语", ko: "韩语", es: "西班牙语", pt: "葡萄牙语", de: "德语", fr: "法语", it: "意大利语", ru: "俄语" };
const maxEntries = 500;
const storageKey = "cs_translator_library_v5";
const legacyStorageKeys = ["cs_translator_library_v4", "cs_translator_library_v3"];
const settingsKey = "cs_translator_settings_v4";
const $ = (id) => document.getElementById(id);
const source = $("source");
const output = $("translation");
const builtins = JSON.parse($("builtin-data").textContent);
const legacyBuiltins = JSON.parse($("legacy-data").textContent);
const providers = {
  deepseek: {name: "DeepSeek", base: "https://api.deepseek.com", models: ["deepseek-flash", "deepseek-v4-pro"]},
  openai: {name: "OpenAI", base: "https://api.openai.com/v1", models: ["gpt-5.4-mini", "gpt-5.4"]},
  gemini: {name: "Google Gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai", models: ["gemini-3.8-flash", "gemini-3.1-flash-lite"]},
  qwen: {name: "通义千问（阿里云百炼）", base: "https://dashscope.aliyuncs.com/compatible-mode/v1", models: ["qwen-plus", "qwen-flash"]},
  custom: {name: "自定义兼容接口", base: "", models: []}
};

function make(tag, value, className) {
  const element = document.createElement(tag);
  if (value != null) element.textContent = value;
  if (className) element.className = className;
  return element;
}

function notice(id, value, kind = "") {
  const element = $(id);
  element.textContent = value;
  element.dataset.kind = kind;
}

function readStorage(key) {
  try { return localStorage.getItem(key); }
  catch { return null; }
}

function writeStorage(key, value) {
  try { localStorage.setItem(key, value); return true; }
  catch { return false; }
}

function languageCode(value) {
  if (typeof value !== "string" || !/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(value.trim()) || value.trim().length > 35) {
    throw new Error("语言代码请使用 th、vi 或 en-GB 这样的国际语言代码。");
  }
  try { return Intl.getCanonicalLocales(value.trim())[0].toLowerCase(); }
  catch { throw new Error("语言代码无效，请检查代码和地区写法。"); }
}

function customLanguage(value) {
  const code = languageCode(value?.code);
  if (Object.hasOwn(builtinLanguages, code)) throw new Error("「" + code + "」已经是内置语种。");
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const guide = typeof value.guide === "string" ? value.guide.trim() : "";
  if (!name || name.length > 24 || /[\r\n]/u.test(name)) throw new Error("请输入 1–24 字的语种显示名称。");
  if (guide.length > 120 || /[\r\n]/u.test(guide)) throw new Error("API 翻译要求最多填写 120 字，且应为一行。");
  return {code, name, guide};
}

function languageMap(customs) {
  return {...builtinLanguages, ...Object.fromEntries(customs.map(({code, name}) => [code, name]))};
}

function checkLanguageNames(customs) {
  const used = new Set(Object.values(builtinLanguages).map(normalized));
  for (const {name} of customs) {
    const key = normalized(name);
    if (!key || used.has(key)) throw new Error("语种显示名称重复或无效，请更换「" + name + "」。");
    used.add(key);
  }
}

function validTranslations(value, knownLanguages) {
  return value && !Array.isArray(value) && typeof value === "object" && Object.entries(value).every(
    ([code, translation]) => Object.hasOwn(knownLanguages, code) && typeof translation === "string" && translation.length <= 4000
  );
}

function restoreLibrary(data) {
  if (![1, 2, 3].includes(data?.version) || !Array.isArray(data.entries) || data.entries.length > maxEntries) {
    throw new Error("请选择本工具导出的词库备份。词库最多支持 500 条。");
  }
  if (data.version === 3 && !Array.isArray(data.customLanguages)) throw new Error("备份缺少自定义语种列表。");
  const customs = data.version === 3 ? data.customLanguages.map(customLanguage) : [];
  if (new Set(customs.map(item => item.code)).size !== customs.length) throw new Error("备份含重复的语言代码。");
  checkLanguageNames(customs);
  const known = languageMap(customs);
  const ids = new Set();
  for (const entry of data.entries) {
    if (!entry || typeof entry.id !== "string" || !/^[\w-]{1,64}$/.test(entry.id) || ids.has(entry.id) ||
        typeof entry.zh !== "string" || !entry.zh.trim() || entry.zh.length > 2000 ||
        typeof entry.category !== "string" || !entry.category.trim() || entry.category.length > 24 ||
        !Array.isArray(entry.keywords) || entry.keywords.some(k => typeof k !== "string") ||
        entry.keywords.join(", ").length > 300 || !validTranslations(entry.translations, known) ||
        (data.version >= 2 && !validTranslations(entry.literal, known))) {
      throw new Error("备份中有无效或重复的话术记录。");
    }
    ids.add(entry.id);
  }
  if (data.version >= 2) return {entries: data.entries, customLanguages: customs};
  const oldById = new Map(legacyBuiltins.map(entry => [entry.id, entry]));
  const newById = new Map(builtins.map(entry => [entry.id, entry]));
  const upgraded = data.entries.map(entry => {
    const old = oldById.get(entry.id);
    const next = newById.get(entry.id);
    if (!old || !next || old.zh !== entry.zh) return {...entry, literal: {}};
    const translations = {};
    const literal = {};
    for (const code of Object.keys(builtinLanguages)) {
      const previous = entry.translations[code];
      const unchanged = previous === old.translations[code];
      translations[code] = unchanged ? next.translations[code] : previous ?? "";
      if (unchanged) literal[code] = next.literal[code];
    }
    return {
      ...next, translations, literal,
      category: entry.category === old.category ? next.category : entry.category,
      keywords: entry.keywords.join("\n") === old.keywords.join("\n") ? next.keywords : entry.keywords
    };
  });
  const additions = builtins.filter(entry => !oldById.has(entry.id) && !ids.has(entry.id));
  return {entries: upgraded.concat(additions.slice(0, maxEntries - upgraded.length)), customLanguages: []};
}

let entries = builtins;
let customLanguages = [];
let loadError = false;
try {
  const stored = readStorage(storageKey) ?? legacyStorageKeys.map(readStorage).find(value => value !== null);
  if (stored) ({entries, customLanguages} = restoreLibrary(JSON.parse(stored)));
} catch { loadError = true; }
let languages = languageMap(customLanguages);
const savedLanguage = readStorage("cs_lang");
let language = Object.hasOwn(languages, savedLanguage) ? savedLanguage : "en";
let serviceAvailable = false;
let settings = {live: false, mode: "ai", provider: "deepseek", model: "deepseek-flash", base: providers.deepseek.base};
try {
  const stored = JSON.parse(readStorage(settingsKey));
  if (stored && Object.hasOwn(providers, stored.provider) && ["browser", "ai"].includes(stored.mode) &&
      typeof stored.model === "string" && typeof stored.base === "string") {
    settings = {live: stored.live === true, mode: stored.mode, provider: stored.provider, model: stored.model, base: stored.base};
  }
} catch { /* Use the matching-first defaults. */ }
let apiKey = "";
let activeTranslation = null;
let result = null;
let editing = null;
let previousLibrary = null;
let editingLanguage = null;

const languageGroups = [$("language-options"), $("library-languages")];
function buildLanguageControls() {
  for (const group of languageGroups) {
    group.replaceChildren(...Object.entries(languages).map(([code, name]) => {
      const button = make("button", name);
      button.type = "button";
      button.dataset.language = code;
      button.addEventListener("click", () => {
        if (language === code) return;
        language = code;
        writeStorage("cs_lang", code);
        resetTranslation();
        renderLanguages();
        renderMatches();
        renderLibrary();
      });
      return button;
    }));
  }
  renderLanguages();
}

function renderLanguages() {
  for (const group of languageGroups) {
    for (const button of group.children) button.setAttribute("aria-pressed", button.dataset.language === language);
  }
  $("target-label").textContent = languages[language] + "译文";
  output.lang = language;
}

const tabs = [...document.querySelectorAll("[data-panel]")];
function showPanel(panelId) {
  for (const button of tabs) {
    const selected = button.dataset.panel === panelId;
    button.setAttribute("aria-pressed", selected);
    $(button.dataset.panel).hidden = !selected;
  }
}
for (const tab of tabs) tab.addEventListener("click", () => showPanel(tab.dataset.panel));

function normalized(text) {
  return text.normalize("NFKC").toLowerCase().trim().replace(/\s+/gu, " ")
    .replace(/(?<=\p{Script=Han}) +| +(?=\p{Script=Han})/gu, "").replace(/[。!.]+$/u, "");
}

function criticalTokens(text) {
  const clean = text.normalize("NFKC").replace(/[–—−〜～]/gu, "-")
    .replace(/(\d)\s*(?:到|至|~)\s*(?=\d)/gu, "$1-")
    .replace(/(\d)\s+(?:to|bis|à|a|до)\s+(?=\d)/giu, "$1-")
    .replace(/(\d)\s*-\s*(?=\d)/gu, "$1-");
  return clean.match(/(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*|(?<!\d)[+-]?\d+(?:[.,:/-]\d+)*(?:%|‰)?/gu) || [];
}

function tokenKey(text) {
  return criticalTokens(text).sort().join("\n");
}

const question = /是否|能否|可否|能不能|会不会|吗|怎么|如何|为什么|\?$/u;
const categoryAliases = new Map([
  ["退款", "退款"], ["退钱", "退款"], ["退费", "退款"], ["返款", "退款"], ["退款申请", "退款"], ["refund", "退款"],
  ["订阅", "订阅"], ["续费", "订阅"], ["续订", "订阅"], ["订阅管理", "订阅"], ["subscription", "订阅"]
]);

function categoryQuery(text) {
  return normalized(text).replace(/\?+$/u, "").replace(/^(?:我想|想要)?(?:了解|咨询)|^关于/u, "")
    .replace(/(?:的?相关问题|的问题|方面|这块|问题)$/u, "");
}

const topics = [
  {
    topic: /退款|退钱|退费|退不了|退还|返款|原路退回|没到账|未到账/u,
    states: [
      ["nonautomatic", /不.{0,4}自动退/u],
      ["missing", /(?:未|没|没有|尚未|还没)(?:收到退款|到账|入账)|退款.{0,5}(?:未|没)收到/u],
      ["failed", /退款.{0,6}(?:失败|未成功|未能完成|未完成)/u],
      ["eligibility", /(?:是否|能否|能不能|可否).{0,8}(?:退款|退钱)|(?:可以退款|能退款|可以退).{0,3}(?:吗|\?)|判断退款资格/u],
      ["question", /(?:了吗|了吗\?|是不是|是否已)|\?$/u],
      ["declined", /退款.{0,10}(?:未获批准|未批准|被拒|未通过|不通过)/u],
      ["approved", /退款.{0,10}(?:获批准|已批准|审核通过|申请通过)|同意退款/u],
      ["review", /退款.{0,10}(?:审核中|正在审核)|(?:审核中|正在审核).{0,8}退款|退款审核/u],
      ["submitted", /(?:退款申请|申请退款).{0,5}已提交|已.{0,7}提交.{0,10}退款申请/u],
      ["received", /(?:收到|受理).{0,10}退款申请|退款申请.{0,5}(?:已受理|已收到)/u],
      ["processing", /退款.{0,8}处理中|(?:正在|还在)处理退款|正在退款/u],
      ["destination", /原路退回|原付[款费]方式|原支付方式|退到原账户|退款去向/u],
      ["progress", /查询.{0,6}退款|查退款|退款进度|退款到哪|退款订单号/u],
      ["question", question],
      ["credited", /已到账|已入账|到账了|已收到退款/u],
      ["partial", /部分.{0,5}退款|退款.{0,5}部分|退还部分|退了一部分|部分费用已退/u],
      ["denied", /(?:不|无法|不能|不给|拒绝|不予|不支持).{0,5}(?:退款|退钱|退费|返款|退还)|退不了|费用不退/u],
      ["issued", /已.{0,10}(?:退款|退钱|退费)|(?:退款|退钱)(?:了|成功|已处理)/u],
      ["allowed", /可以.{0,4}退|支持.{0,4}退|能退款|符合退款条件/u]
    ]
  },
  {
    topic: /续费|续订|续期|自动更新|试用/u,
    states: [
      ["trial", /试用/u],
      ["failed", /续费.{0,10}(?:未成功|失败)|付款未成功/u],
      ["success", /续费成功|已续费|已续期|已续订|续订成功|已成功续费/u],
      ["date", /下次续费|续费日期|什么时候续费|续费时间/u],
      ["charged", /续费.{0,5}(?:扣费|扣款|收费|账单)|(?:扣费|这笔).{0,10}续费/u],
      ["disabled", /已.{0,7}(?:关闭|停止|取消|停用).{0,5}(?:续费|续订)|续费已关闭|关闭续费成功/u],
      ["disable-guide", /(?:关闭|停止|取消|停用).{0,5}(?:续费|续订)|(?:续费|续订).{0,5}(?:关闭|停止)/u],
      ["question", question],
      ["nonrenewing", /不.{0,5}(?:续费|续订|自动更新)/u],
      ["renewing", /自动续费|自动续订/u]
    ]
  },
  {
    topic: /取消|解约|退订|解订/u,
    states: [
      ["blocked", /(?:不要|别|无需|不用|不能|无法).{0,5}(?:取消|解约|退订)/u],
      ["renewal", /(?:关闭|停止|取消|停用).{0,5}(?:续费|续订)/u],
      ["charge-after", /(?:取消|解约|退订).{0,16}(?:扣费|扣款)/u],
      ["refund-after", /(?:取消|解约|退订).{0,16}(?:退款|退还|费用)/u],
      ["access-after", /(?:取消|解约|退订).{0,16}(?:还能用|使用|有效|权益)/u],
      ["processing", /(?:取消|解约|退订).{0,14}(?:处理中|还在处理|尚未完成)/u],
      ["received", /(?:收到|受理).{0,10}(?:取消|解约|退订)|(?:取消|解约|退订).{0,8}(?:请求|申请)已收到/u],
      ["question", /是否|能否|能不能|可否/u],
      ["done", /已.{0,8}(?:取消|解约|退订)|取消了|取消成功|解约了/u],
      ["guide", /取消|解约|退订/u]
    ]
  }
];

function topicState(text, {topic, states}) {
  if (!topic.test(text)) return "";
  return states.find(([, pattern]) => pattern.test(text))?.[0] || "other";
}

function hasConflict(query, phrase) {
  if (tokenKey(query) !== tokenKey(phrase)) return true;
  const cadence = /每(?:隔)?(?:天|日|周|星期|月|季度|季|年)|按(?:天|日|周|月|季|年)/gu;
  if ((query.match(cadence) || []).join() !== (phrase.match(cadence) || []).join()) return true;
  let classified = false;
  for (const topic of topics) {
    const left = topicState(query, topic);
    const right = topicState(phrase, topic);
    if (left && right && left !== right && left !== "other" && right !== "other") return true;
    if (left && left === right && left !== "other") classified = true;
  }
  if (classified) return false;
  const negative = /不要|不想|不需要|别[发提供清重取退]|无需|不用|不能|无法|未能|不会|不可以|不予|没[有收到发取消]|退不了/u;
  return negative.test(query) !== negative.test(phrase);
}

function ngrams(text) {
  const letters = [...text];
  return new Set(letters.slice(0, -1).map((letter, i) => letter + letters[i + 1]));
}

function similarity(left, right) {
  if (left.length < 2 || right.length < 2) return 0;
  const ratio = Math.min(left.length, right.length) / Math.max(left.length, right.length);
  if (left.includes(right) || right.includes(left)) return 0.60 + 0.26 * ratio;
  const a = ngrams(left);
  const b = ngrams(right);
  const common = [...a].filter(value => b.has(value)).length;
  return a.size + b.size ? 2 * common / (a.size + b.size) : 0;
}

function rank(query, library) {
  const text = normalized(query);
  if (!text) return [];
  const subject = categoryQuery(text);
  const theme = categoryAliases.get(subject) ?? subject;
  const byCategory = library.filter(entry => normalized(entry.category) === theme);
  if (byCategory.length || categoryAliases.has(subject)) {
    const related = categoryAliases.has(subject)
      ? library.filter(entry => normalized(entry.category) !== theme && [entry.zh, ...entry.keywords].some(value => {
        const keyword = normalized(value);
        return keyword.includes(theme) || keyword.includes(subject);
      })) : [];
    return byCategory.concat(related).map(entry => ({entry, kind: "主题匹配"}));
  }
  const input = text.replace(/^(?:麻烦您|麻烦你|请问|请您|请|帮我)/u, "").replace(/(?:一下|吧|呢)$/u, "");
  const hits = [];
  for (const entry of library) {
    const phrase = normalized(entry.zh);
    if (text === phrase && tokenKey(query) === tokenKey(entry.zh)) {
      hits.push({entry, score: 1, kind: "原句匹配"});
      continue;
    }
    if (hasConflict(text, phrase)) continue;
    const comparison = [similarity(text, phrase), similarity(input, phrase)];
    for (const keyword of entry.keywords) {
      const key = normalized(keyword);
      if (key.length > 1 && (text.includes(key) || input === key)) {
        comparison.push(input === key ? 0.91 : 0.63 + 0.22 * key.length / text.length);
      } else if (input.length > 1 && key.startsWith(input) && input.length >= key.length / 2) {
        comparison.push(0.57 + 0.18 * input.length / key.length);
      }
    }
    const score = Math.max(...comparison);
    if (score >= 0.53) hits.push({entry, score, kind: "模糊匹配"});
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 5);
}

async function copy(value, status) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(value);
    status("已复制。");
    return true;
  } catch {
    const focused = document.activeElement;
    const field = make("textarea");
    field.value = value;
    field.setAttribute("readonly", "");
    field.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.append(field);
    field.select();
    let copied = false;
    try { copied = document.execCommand("copy") === true; }
    catch { /* Use the visible copy status. */ }
    finally { field.remove(); focused?.focus(); }
    status(copied ? "已复制。" : "复制失败，请选中文字后手动复制。", copied ? "" : "error");
    return copied;
  }
}

function action(label, run, extraClass = "") {
  const button = make("button", label, "btn " + extraClass);
  button.type = "button";
  button.addEventListener("click", run);
  return button;
}

function setSource(value) {
  source.value = value;
  showPanel("translate-panel");
  onSourceChange();
  source.focus();
}

function phraseCard(entry, reference) {
  const card = make("article", null, "card phrase-card");
  const tags = make("div", null, "tags");
  tags.append(make("span", entry.category, "tag"));
  if (reference) tags.append(make("span", reference, "tag reference"));
  const chinese = make("h3", entry.zh);
  const translation = entry.translations[language];
  const foreign = make("p", translation || "这条话术还未填写" + languages[language] + "译文。", translation ? "foreign" : "foreign quiet");
  if (translation) {
    const translated = make("span", translation);
    translated.lang = language;
    const literal = entry.literal[language];
    foreign.replaceChildren(translated, make("small", "（" + (literal || "中文直译待补充") + "）", "literal"));
  }
  const buttons = make("div", null, "actions");
  const status = make("p", null, "notice");
  status.setAttribute("role", "status");
  buttons.append(action(reference ? "用这句作原文" : "带入翻译", () => setSource(entry.zh)));
  if (translation) buttons.append(action(reference && reference !== "原句匹配" ? "复制参考译文" : "复制译文", () =>
    copy(translation, (message, kind) => { status.textContent = message; status.dataset.kind = kind || ""; })));
  if (!reference) {
    buttons.append(action("编辑", () => openEditor(entry)), action("删除", () => removeEntry(entry), "danger"));
  }
  card.append(tags, chinese, foreign, buttons, status);
  return card;
}

function renderMatches() {
  const area = $("matches");
  const text = source.value.trim();
  $("match-summary").textContent = "";
  area.replaceChildren();
  area.className = "";
  if (!text) {
    const examples = make("div", null, "examples");
    for (const example of ["退款", "退款审核中", "关闭自动续费", "重复扣费"]) {
      examples.append(action(example, () => setSource(example)));
    }
    area.append(make("p", "输入原句或关键词，也可以试试这些常见场景。", "empty"), examples);
    return;
  }
  const matches = rank(text, entries);
  if (!matches.length) {
    area.append(make("p", settings.live ? "没有合适的常用语。可以使用实时翻译。" : "没有合适的常用语。试试更短的关键词，或在词库新增话术。", "empty"));
    return;
  }
  area.className = "reference-grid";
  $("match-summary").textContent = matches[0].kind === "主题匹配"
    ? "找到 " + matches.length + " 条相关话术。输入更具体的业务状态可以缩小范围。"
    : "找到 " + matches.length + " 条参考话术。";
  area.append(...matches.map(hit => phraseCard(hit.entry, hit.kind)));
}

function renderLibrary() {
  const category = $("category");
  const selected = category.value;
  const categories = [...new Set(entries.map(entry => entry.category))];
  category.replaceChildren(new Option("全部分类", ""), ...categories.map(name => new Option(name, name)));
  category.value = categories.includes(selected) ? selected : "";
  $("category-options").replaceChildren(...categories.map(name => new Option(name, name)));
  const search = normalized($("search").value);
  const theme = categoryAliases.get(categoryQuery(search));
  const rows = entries.filter(entry => (!category.value || entry.category === category.value) &&
    (!search || (theme && normalized(entry.category) === theme) ||
      [entry.zh, entry.category, ...entry.keywords, ...Object.values(entry.translations), ...Object.values(entry.literal)]
      .some(value => normalized(value).includes(search))));
  $("library-count").textContent = "显示 " + rows.length + " / " + entries.length + " 条";
  $("library-list").replaceChildren(...(rows.length ? rows.map(entry => phraseCard(entry)) :
    [make("p", "没有找到符合条件的话术。", "empty")]));
}

function libraryBackup() {
  return {version: 3, entries, customLanguages};
}

function applyLibrary(next, nextLanguages) {
  entries = next;
  if (nextLanguages !== customLanguages) {
    customLanguages = nextLanguages;
    languages = languageMap(customLanguages);
    if (!Object.hasOwn(languages, language)) {
      language = "en";
      writeStorage("cs_lang", language);
    }
    resetTranslation();
    buildLanguageControls();
    renderCustomLanguages();
    if (editingLanguage && !customLanguages.some(item => item.code === editingLanguage)) fillLanguageForm();
  }
  renderLibrary();
  renderMatches();
}

function updateLibrary(next, message, nextLanguages = customLanguages) {
  previousLibrary = libraryBackup();
  applyLibrary(next, nextLanguages);
  const persisted = writeStorage(storageKey, JSON.stringify(libraryBackup()));
  notice("libraryMessage", persisted ? message : message + " 浏览器存储不可用，本次修改仅在当前页面保留。", persisted ? "" : "warning");
  $("undo").hidden = false;
  return persisted;
}

function removeEntry(entry) {
  updateLibrary(entries.filter(item => item.id !== entry.id), "已删除话术，可撤销。");
  $("undo").focus();
}

function buildEditorControls() {
  $("editor-language").replaceChildren();
  $("entry-translations").replaceChildren();
  for (const [code, name] of Object.entries(languages)) {
    $("editor-language").add(new Option(name, code));
    const group = make("div", null, "entry-fields");
    group.dataset.code = code;
    const label = make("label", name + "译文", "field");
    const area = make("textarea");
    area.id = "entry-" + code;
    area.rows = 2;
    area.maxLength = 4000;
    area.lang = code;
    label.append(area);
    const glossLabel = make("label", "中文直译", "field");
    const gloss = make("textarea");
    gloss.id = "entry-literal-" + code;
    gloss.rows = 2;
    gloss.maxLength = 4000;
    glossLabel.append(gloss);
    group.append(label, glossLabel);
    $("entry-translations").append(group);
  }
}

function showEditorLanguage() {
  for (const group of $("entry-translations").children) group.hidden = group.dataset.code !== $("editor-language").value;
}
$("editor-language").addEventListener("change", showEditorLanguage);

function openEditor(entry = null, translation = null) {
  editing = entry;
  buildEditorControls();
  $("editor-title").textContent = entry ? "编辑话术" : "新增话术";
  $("entry-source").value = entry?.zh ?? translation?.source ?? "";
  $("entry-category").value = entry?.category ?? "";
  $("entry-keywords").value = entry?.keywords.join(", ") ?? "";
  for (const code of Object.keys(languages)) {
    $("entry-" + code).value = entry?.translations[code] ?? (translation?.language === code ? translation.text : "");
    $("entry-literal-" + code).value = entry?.literal[code] ?? "";
  }
  $("editor-language").value = language;
  showEditorLanguage();
  notice("editor-status", "");
  $("editor").showModal();
  $("entry-source").focus();
}

$("add").addEventListener("click", () => openEditor());
$("cancel-editor").addEventListener("click", () => $("editor").close());

function parseKeywords(text) {
  return [...new Set(text.split(/[,，、;；\r\n]+/u).map(word => word.trim()).filter(Boolean))];
}

function newEntryId() {
  return "user-" + [...crypto.getRandomValues(new Uint32Array(4))].map(n => n.toString(16).padStart(8, "0")).join("");
}

$("editor-form").addEventListener("submit", event => {
  event.preventDefault();
  const zh = $("entry-source").value.trim();
  if (!zh) return notice("editor-status", "请输入中文原文。", "error");
  if (!editing && entries.length >= maxEntries) return notice("editor-status", "词库已达到 500 条。", "error");
  if (entries.some(entry => entry.id !== editing?.id && normalized(entry.zh) === normalized(zh))) {
    return notice("editor-status", "词库里已有相同的原句，请编辑已有话术。", "error");
  }
  if (editing && !entries.some(entry => entry.id === editing.id)) {
    return notice("editor-status", "此条话术已在其他页面删除，请关闭后重新新增。", "error");
  }
  const keywords = parseKeywords($("entry-keywords").value);
  if (keywords.join(", ").length > 300) return notice("editor-status", "关键词太长，请缩短后保存。", "error");
  const current = entries.find(entry => entry.id === editing?.id);
  const translations = Object.fromEntries(Object.keys(languages).map(code =>
    [code, $("entry-" + code)?.value.trim() ?? current?.translations[code] ?? ""]));
  const literal = Object.fromEntries(Object.keys(languages).map(code =>
    [code, $("entry-literal-" + code)?.value.trim() ?? current?.literal[code] ?? ""]));
  if ([...Object.values(translations), ...Object.values(literal)].some(value => value.length > 4000)) {
    return notice("editor-status", "每种语言的译文及中文直译各限 4000 字。", "error");
  }
  const entry = {
    id: editing?.id ?? newEntryId(),
    zh,
    category: $("entry-category").value.trim() || "自定义",
    keywords,
    translations,
    literal
  };
  updateLibrary(editing ? entries.map(item => item.id === entry.id ? entry : item) : [entry, ...entries], "已保存话术。");
  $("editor").close();
  if ($("library-panel").hidden) notice("copy-status", "已保存到常用语词库。");
});
$("search").addEventListener("input", renderLibrary);
$("category").addEventListener("change", renderLibrary);

$("undo").addEventListener("click", () => {
  if (!previousLibrary) return;
  applyLibrary(previousLibrary.entries, previousLibrary.customLanguages);
  previousLibrary = null;
  const persisted = writeStorage(storageKey, JSON.stringify(libraryBackup()));
  $("undo").hidden = true;
  notice("libraryMessage", persisted ? "已撤销上一次词库更改。" : "当前页面已撤销更改，浏览器未能保存。", persisted ? "" : "warning");
});

$("export").addEventListener("click", () => {
  const data = JSON.stringify(libraryBackup(), null, 2);
  const url = URL.createObjectURL(new Blob([data], {type: "application/json"}));
  const link = make("a");
  link.href = url;
  link.download = "客服常用语词库.json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notice("libraryMessage", "已生成词库备份。");
});
$("import").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async event => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    if (file.size > 45_000_000) throw new Error("备份文件过大。");
    const next = restoreLibrary(JSON.parse(await file.text()));
    updateLibrary(next.entries, "已用备份恢复 " + next.entries.length + " 条话术，可撤销。", next.customLanguages);
  } catch (error) {
    notice("libraryMessage", error instanceof SyntaxError ? "无法读取此 JSON 备份文件。" : error.message, "error");
  }
});

$("export-excel").addEventListener("click", () => {
  try {
    XLSX.writeFile(libraryWorkbook(libraryBackup()), "客服常用语词库.xlsx", {bookType: "xlsx", compression: true});
    notice("libraryMessage", "已生成 Excel 词库。打开「填写说明」查看编辑规则。");
  } catch (error) {
    notice("libraryMessage", "导出 Excel 失败。" + (error.message || ""), "error");
  }
});
$("import-excel").addEventListener("click", () => $("import-excel-file").click());
$("import-excel-file").addEventListener("change", async event => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    if (!/\.xlsx$/i.test(file.name)) throw new Error("请在 Excel 中另存为 .xlsx 后导入。");
    if (file.size > 45_000_000) throw new Error("Excel 文件过大。");
    const book = XLSX.read(await file.arrayBuffer(), {type: "array"});
    const next = importLibraryWorkbook(book, libraryBackup());
    const {added, updated, removed, languages: changedLanguages} = next.counts;
    updateLibrary(next.entries, "Excel 已导入。新增 " + added + " 条，更新 " + updated + " 条，删除 " + removed +
      " 条，语种变更 " + changedLanguages + " 个。可撤销。", next.customLanguages);
  } catch (error) {
    notice("libraryMessage", "导入失败。" + (error.message || "请检查 Excel 文件格式。"), "error");
  }
});

window.addEventListener("storage", event => {
  if (event.key !== storageKey) return;
  try {
    const next = event.newValue === null ? {entries: builtins, customLanguages: []} : restoreLibrary(JSON.parse(event.newValue));
    applyLibrary(next.entries, next.customLanguages);
    previousLibrary = null;
    $("undo").hidden = true;
    notice("libraryMessage", "已同步其他页面的词库更改。");
  } catch {
    notice("libraryMessage", "其他页面的词库更改无法读取。", "error");
  }
});

function fillLanguageForm(item = null) {
  editingLanguage = item?.code ?? null;
  $("custom-language-code").value = item?.code ?? "";
  $("custom-language-code").readOnly = Boolean(item);
  $("custom-language-name").value = item?.name ?? "";
  $("custom-language-guide").value = item?.guide ?? "";
  $("custom-language-save").textContent = item ? "保存语种" : "添加语种";
  $("custom-language-cancel").hidden = !item;
}

function renderCustomLanguages() {
  const list = $("custom-language-list");
  list.replaceChildren(...customLanguages.map(item => {
    const row = make("li", null, "custom-language-row");
    row.append(make("span", item.name + " [" + item.code + "]"),
      action("编辑", () => {
        fillLanguageForm(item);
        notice("custom-language-status", "");
        $("custom-language-name").focus();
      }));
    return row;
  }));
  list.hidden = !customLanguages.length;
}

$("custom-language-cancel").addEventListener("click", () => fillLanguageForm());
$("custom-language-form").addEventListener("submit", event => {
  event.preventDefault();
  try {
    const item = customLanguage({
      code: $("custom-language-code").value,
      name: $("custom-language-name").value,
      guide: $("custom-language-guide").value
    });
    if (!editingLanguage && Object.hasOwn(languages, item.code)) throw new Error("语言代码已存在，请在列表中编辑。");
    const next = editingLanguage
      ? customLanguages.map(other => other.code === item.code ? item : other)
      : customLanguages.concat(item);
    checkLanguageNames(next);
    const message = "已保存「" + item.name + "」。可在词库中填写译文，或导出 Excel 批量编辑。";
    const persisted = updateLibrary(entries, message, next);
    fillLanguageForm();
    notice("custom-language-status", persisted ? message : message + " 浏览器存储不可用，本次修改仅在当前页面保留。",
      persisted ? "" : "warning");
  } catch (error) {
    notice("custom-language-status", error.message, "error");
  }
});

const politePhrases = new Map([
  ["等一下", "请您稍候片刻"], ["稍等", "请您稍候片刻"],
  ["稍等一下", "请您稍候片刻"], ["请稍等", "请您稍候片刻"],
  ["你什么问题", "请问您遇到了什么问题"], ["你听懂了吗", "请问我刚才解释清楚了吗"],
  ["你错了", "这里可能有些误会"], ["不行", "很抱歉，这项请求无法办理"],
  ["请冷静", "我理解您现在的感受，我们可以一步一步来"], ["退不了款", "很抱歉，这笔款项无法退款"]
]);
const courteousWait = {
  en: "Could you give me a moment, please?",
  ja: "少々お待ちいただけますか。",
  ko: "잠시만 기다려 주시겠어요?",
  es: "¿Podría esperar un momento, por favor?",
  pt: "Poderia aguardar um momento, por favor?",
  de: "Könnten Sie bitte einen Moment warten?",
  fr: "Pourriez-vous patienter un instant, s’il vous plaît ?",
  it: "Potrebbe attendere un momento, per favore?",
  ru: "Пожалуйста, подождите немного."
};

function politeSource(text) {
  return text.split(/([。！？!?\n]+)/u).map((segment, index) => {
    if (index % 2 || !segment.trim()) return segment;
    const plain = segment.trim();
    if (politePhrases.has(plain)) return politePhrases.get(plain);
    if (/^请(?=确认|核对|提供|发送)/u.test(plain)) return "麻烦您" + plain.slice(1);
    if (/^(?:稍等|发(?:一下)?截图|给我发|给我提供|把.{1,60}(?:发|给)我|重启(?:一下)?(?:App|应用|设备)|告诉我)/iu.test(plain)) {
      return "麻烦您" + plain.replace(/^(?:给我发|给我提供)/u, verb => verb.slice(2));
    }
    return segment;
  }).join("");
}

function resetTranslation() {
  if (activeTranslation) activeTranslation.abort();
  activeTranslation = null;
  result = null;
  output.textContent = "";
  $("engine-label").textContent = "";
  $("output-card").setAttribute("aria-busy", "false");
  $("copy-result").disabled = true;
  $("save-result").disabled = true;
  $("translate-button").disabled = false;
  $("translate-button").textContent = "实时翻译";
  notice("translate-status", "");
  notice("copy-status", "");
}

function onSourceChange() {
  $("char-count").textContent = source.value.length + " / 2000";
  resetTranslation();
  renderMatches();
}
source.addEventListener("input", onSourceChange);
source.addEventListener("keydown", event => {
  if (settings.live && !event.isComposing && event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    if (!activeTranslation) $("translate-form").requestSubmit();
  }
});
$("clear-source").addEventListener("click", () => setSource(""));
function renderWorkspace() {
  $("translate-form").classList.toggle("match-only", !settings.live);
  for (const id of ["translate-button", "copy-prompt", "output-card", "serviceNote"]) $(id).hidden = !settings.live;
  if (!settings.live) return;
  if (settings.mode === "browser") {
    const supported = "Translator" in globalThis;
    notice("serviceNote", supported ? "浏览器本地翻译 · 首次使用某些语言时可能需要下载语言包。" :
      "当前浏览器不支持本地翻译，可继续匹配常用语，或在设置中切换到 API 客服翻译。", supported ? "" : "warning");
  } else {
    const ready = serviceAvailable && apiKey;
    notice("serviceNote", ready ? providers[settings.provider].name + " · " + settings.model + "。点击实时翻译会向该服务发送原文。" :
      "API 客服翻译尚未就绪。请通过启动脚本打开页面，并在设置中填写密钥。", ready ? "" : "warning");
  }
}

for (const [id, provider] of Object.entries(providers)) $("settings-provider").add(new Option(provider.name, id));

function renderModelChoices(provider, model) {
  const select = $("settings-model");
  select.replaceChildren(...providers[provider].models.map(name => new Option(name, name)),
    new Option("输入其他模型 ID", "__custom__"));
  select.value = providers[provider].models.includes(model) ? model : "__custom__";
  $("settings-model-custom").value = select.value === "__custom__" ? model : "";
  $("custom-model-row").hidden = select.value !== "__custom__";
}

function renderSettingsMode() {
  const api = $("settings-mode").value === "ai";
  $("settings-api").hidden = !api;
  $("test-api").hidden = !api;
  notice("settings-mode-note", api ? "通过本机服务调用所选模型生成客服译文。" :
    "由桌面浏览器本地翻译。常用语匹配始终可用。");
}

function loadSettingsForm() {
  $("settings-live").checked = settings.live;
  $("settings-mode").value = settings.mode;
  $("settings-provider").value = settings.provider;
  renderModelChoices(settings.provider, settings.model);
  $("settings-base").value = settings.base;
  $("settings-key").value = apiKey;
  renderSettingsMode();
}

$("settings-mode").addEventListener("change", renderSettingsMode);
$("settings-provider").addEventListener("change", () => {
  const provider = $("settings-provider").value;
  renderModelChoices(provider, providers[provider].models[0] || "");
  $("settings-base").value = providers[provider].base;
  $("settings-key").value = "";
  notice("settings-status", "");
});
$("settings-model").addEventListener("change", () => {
  $("custom-model-row").hidden = $("settings-model").value !== "__custom__";
});
$("settings-base").addEventListener("input", () => {
  if ($("settings-key").value === apiKey) $("settings-key").value = "";
});

function settingsDraft() {
  const draft = {
    live: $("settings-live").checked,
    mode: $("settings-mode").value,
    provider: $("settings-provider").value,
    model: $("settings-model").value === "__custom__" ? $("settings-model-custom").value.trim() : $("settings-model").value,
    base: $("settings-base").value.trim().replace(/\/+$/u, "")
  };
  if (draft.mode === "ai") {
    if (!draft.model) throw new Error("请选择模型，或填写自定义模型 ID。");
    let url;
    try { url = new URL(draft.base); } catch { throw new Error("请填写有效的 API 基址。"); }
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
        url.username || url.password || url.search || url.hash) {
      throw new Error("API 基址应为 HTTPS 地址，或本机 HTTP 地址。");
    }
  }
  return draft;
}

$("settings-form").addEventListener("submit", event => {
  event.preventDefault();
  try {
    settings = settingsDraft();
    apiKey = $("settings-key").value.trim();
    const saved = writeStorage(settingsKey, JSON.stringify(settings));
    resetTranslation();
    renderWorkspace();
    renderMatches();
    notice("settings-status", saved ? "设置已保存。" : "设置已应用到当前页面，浏览器未能保存。", saved ? "" : "warning");
  } catch (error) {
    notice("settings-status", error.message, "error");
  }
});

async function detectService() {
  if (location.protocol !== "file:") {
    try {
      const reply = await fetch("/api/status", {cache: "no-store", signal: AbortSignal.timeout(3500)});
      if (reply.ok) serviceAvailable = (await reply.json()).version === 4;
    } catch { /* Matching works without the local service. */ }
  }
  notice("settings-service", serviceAvailable ? "本机 API 服务已启动。" :
    "使用 API 时，请从 Windows 启动脚本（或 Mac 启动脚本）打开网页。", serviceAvailable ? "" : "warning");
  renderWorkspace();
}

$("test-api").addEventListener("click", async () => {
  const button = $("test-api");
  try {
    const draft = settingsDraft();
    const key = $("settings-key").value.trim();
    button.disabled = true;
    notice("settings-status", "正在测试所选模型…");
    await aiTranslation("您好，请稍等片刻。", "en", {provider: draft.provider, model: draft.model, base: draft.base, key}, AbortSignal.timeout(45_000));
    notice("settings-status", "连接成功。点「保存设置」应用。");
  } catch (error) {
    notice("settings-status", error.message || "连接失败，请核对配置。", "error");
  } finally {
    button.disabled = false;
  }
});

async function browserTranslation(text, code, controller) {
  if (!("Translator" in globalThis)) {
    throw new Error("此浏览器未提供本地翻译。请用桌面版 Chrome，或配置 AI 客服翻译。");
  }
  const waitOpening = courteousWait[code] && /^(?:等一下|(?:请(?:您)?)?稍等(?:一下|片刻)?)(?:[。！？!?]\s*|\n+\s*|$)/u.exec(text);
  const remaining = waitOpening ? text.slice(waitOpening[0].length) : text;
  if (!remaining) return courteousWait[code];
  const options = {sourceLanguage: "zh", targetLanguage: code, signal: controller.signal};
  let translator;
  try {
    translator = await Translator.create({
      ...options,
      monitor(monitor) {
        monitor.addEventListener("downloadprogress", event => {
          if (activeTranslation !== controller) return;
          const percent = Math.round(event.loaded * 100);
          notice("translate-status", percent >= 100 ? "语言包已就绪，正在翻译…" : "正在下载语言包 " + percent + "%…");
        });
      }
    });
    const translated = await translator.translate(politeSource(remaining), {signal: controller.signal});
    if (!waitOpening || !translated.trim()) return translated;
    const separator = waitOpening[0].includes("\n") ? "\n" : " ";
    return courteousWait[code] + separator + translated.trim();
  } catch (error) {
    if (controller.signal.aborted) throw error;
    throw new Error("无法使用「" + languages[code] + "」的本地语言包。请确认浏览器支持该语种且能联网下载，或切换到 API 客服翻译。");
  } finally {
    translator?.destroy?.();
  }
}

async function aiTranslation(text, code, api, signal) {
  if (!serviceAvailable) throw new Error("请先用启动脚本打开本机 API 服务。");
  if (!api.key) throw new Error("请在设置中填写 API 密钥。");
  let response;
  try {
    const locale = customLanguages.find(item => item.code === code);
    const payload = {text, target: code, api};
    if (locale) payload.targetLocale = {name: locale.name, guide: locale.guide};
    response = await fetch("/api/translate", {
      method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload), signal
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error("连接不到本地翻译服务，请确认启动窗口还开着。");
  }
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "AI 翻译服务暂时不可用。");
  if (typeof payload.translation !== "string" || !payload.translation.trim()) throw new Error("API 服务未返回有效译文。");
  return payload.translation;
}

$("translate-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!settings.live || activeTranslation) return;
  const text = source.value.trim();
  if (!/\p{Script=Han}/u.test(text)) return notice("translate-status", "请输入需要翻译的中文客服回复。", "error");
  const code = language;
  const mode = settings.mode;
  resetTranslation();
  const controller = new AbortController();
  activeTranslation = controller;
  $("output-card").setAttribute("aria-busy", "true");
  $("translate-button").disabled = true;
  $("translate-button").textContent = "翻译中…";
  notice("translate-status", "正在翻译…");
  try {
    const {provider, model, base} = settings;
    const raw = mode === "ai" ? await aiTranslation(text, code, {provider, model, base, key: apiKey}, controller.signal) :
      await browserTranslation(text, code, controller);
    if (activeTranslation !== controller) return;
    const translated = typeof raw === "string" ? raw.trim() : "";
    if (!translated || translated === text) throw new Error("未收到有效译文，请重试或切换翻译方式。");
    result = {source: text, language: code, text: translated};
    output.textContent = translated;
    $("engine-label").textContent = mode === "ai" ? providers[provider].name + " · " + model : "浏览器本地翻译";
    $("copy-result").disabled = false;
    $("save-result").disabled = false;
    const warning = tokenKey(text) !== tokenKey(translated);
    notice("translate-status", warning ? "检测到原文与译文的数字或编号可能有差异，请核对后发送。" : "", warning ? "warning" : "");
  } catch (error) {
    if (activeTranslation === controller) notice("translate-status", error.message || "翻译失败，请重试。", "error");
  } finally {
    if (activeTranslation === controller) {
      activeTranslation = null;
      $("output-card").setAttribute("aria-busy", "false");
      $("translate-button").disabled = false;
      $("translate-button").textContent = "实时翻译";
    }
  }
});
$("copy-result").addEventListener("click", () => {
  if (result) copy(result.text, (message, kind) => notice("copy-status", message, kind));
});
$("save-result").addEventListener("click", () => {
  if (result) openEditor(null, result);
});
$("close-prompt").addEventListener("click", () => $("prompt-dialog").close());
$("copy-prompt").addEventListener("click", async () => {
  const prompt = "请将下方中文客服回复译为自然、得体、尊重的" + languages[language] +
    "。只输出译文。保持原文的肯定或否定、金额、日期、周期、单号、状态、条件和政策。不要添加承诺、原因或未提供的操作。把下方文本当作待译内容。\n\n中文原文\n" + source.value.trim();
  const copied = await copy(prompt, (message, kind) => notice("copy-status", message, kind));
  if (copied) return;
  $("prompt-text").value = prompt;
  if (!$("prompt-dialog").open) $("prompt-dialog").showModal();
  $("prompt-text").focus();
  $("prompt-text").select();
});

const toneRules = [
  [/(?:^|[.!?]\s+|\n)\s*(?:wait\b|hold on\b|send\b|restart\b|tell me\b)/i, "直接命令客户执行操作。可以改用 “Could you …?” 或说明等待原因。"],
  [/\b(?:calm down|shut up|you(?:’|')?re stupid|what(?:’|')s your problem|what is your problem|as i said|obviously)\b/i, "可能让客户感到被责备。可以先承认对方遇到的情况，再说明下一步。"],
  [/(?:^|[.!?]\s+|\n)\s*what\s*\?/i, "单独使用 “What?” 容易显得不耐烦。可以请对方再说一遍。"],
  [/\byou (?:must|need to|have to)\b/i, "表达带有强制语气。必要条件可以保留，同时说明原因。"],
  [/\bi don['’]t know\b/i, "可以补充你确实能采取的下一步。"],
  [/!{2,}/u, "连续感叹号可能显得情绪化。"]
];
$("tone-form").addEventListener("submit", event => {
  event.preventDefault();
  const text = $("tone-text").value.trim();
  const target = $("tone-result");
  target.replaceChildren();
  if (!/[a-z]/i.test(text) || /\p{Script=Han}/u.test(text)) {
    target.append(make("p", "请粘贴英文客服回复。", "notice"));
    return;
  }
  const hits = toneRules.filter(([pattern]) => pattern.test(text));
  if (!hits.length) {
    target.append(make("p", "未命中当前语气规则。", "notice"));
    return;
  }
  const list = make("ul");
  for (const [, advice] of hits) list.append(make("li", advice));
  target.append(list);
});
$("tone-text").addEventListener("input", () => $("tone-result").replaceChildren());
$("tone-clear").addEventListener("click", () => {
  $("tone-text").value = "";
  $("tone-result").replaceChildren();
  $("tone-text").focus();
});

buildLanguageControls();
renderCustomLanguages();
loadSettingsForm();
renderWorkspace();
renderMatches();
renderLibrary();
if (loadError) notice("libraryMessage", "本地词库读取失败，已显示内置话术。可导入备份恢复。", "warning");
detectService();
