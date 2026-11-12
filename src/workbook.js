"use strict";

const workbookFields = ["词条编号", "中文原文", "分类", "关键词", "操作"];
const workbookLanguageFields = ["语言代码", "显示名称", "API 翻译要求"];

function libraryWorkbook(state) {
  const names = languageMap(state.customLanguages);
  const codes = Object.keys(names);
  const headings = workbookFields.concat(codes.flatMap(code => [
    names[code] + "译文 [" + code + "]", names[code] + "中文直译 [" + code + "]"
  ]));
  const phrases = [headings, ...state.entries.map(entry => [
    entry.id, entry.zh, entry.category, entry.keywords.join("；"), "",
    ...codes.flatMap(code => [entry.translations[code] ?? "", entry.literal[code] ?? ""])
  ])];
  const locales = [workbookLanguageFields, ...Object.entries(builtinLanguages).map(([code, name]) => [code, name, ""]),
    ...state.customLanguages.map(({code, name, guide}) => [code, name, guide])];
  const instructions = [
    ["要做什么", "怎么填"],
    ["修改现有话术", "保留词条编号，直接修改对应的中文原文、分类、关键词、译文或中文直译。"],
    ["新增话术", "另起一行，填写中文原文。词条编号可以留空。没有编号时按中文原文匹配，找不到同句才新建。"],
    ["删除话术", "保留词条编号，在「操作」列填写「删除」。整行从 Excel 移除时，软件会保留该词条。"],
    ["清空内容", "已有列的译文、直译或关键词留空会清空对应内容。省略整列会保留已有内容。"],
    ["关键词", "多个关键词用中文分号、逗号或换行隔开。"],
    ["新增语种", "推荐先在设置中添加语种，再导出 Excel。也可在「语种」表增加一行，例如 th、泰语、使用泰国客服敬语。"],
    ["新增译文列", "在「话术」表增加泰语译文 [th]、泰语中文直译 [th] 两列。方括号中填写已配置的语言代码。"],
    ["语种规则", "使用 th、vi 或 en-GB 等语言代码。代码和显示名称须唯一。内置语种保留原名称。API 翻译要求可留空。"],
    ["保存与导入", "保留工作表名称和第一行列名，填写纯文本，保存为 .xlsx。导入会合并表内记录，导入后可撤销。"]
  ];
  const book = XLSX.utils.book_new();
  const phraseSheet = XLSX.utils.aoa_to_sheet(phrases);
  phraseSheet["!cols"] = [18, 48, 14, 54, 12, ...codes.flatMap(() => [55, 43])].map(wch => ({wch}));
  phraseSheet["!autofilter"] = {ref: phraseSheet["!ref"]};
  const languageSheet = XLSX.utils.aoa_to_sheet(locales);
  languageSheet["!cols"] = [18, 23, 50].map(wch => ({wch}));
  const guideSheet = XLSX.utils.aoa_to_sheet(instructions);
  guideSheet["!cols"] = [22, 110].map(wch => ({wch}));
  XLSX.utils.book_append_sheet(book, phraseSheet, "话术");
  XLSX.utils.book_append_sheet(book, languageSheet, "语种");
  XLSX.utils.book_append_sheet(book, guideSheet, "填写说明");
  return book;
}

function workbookTable(book, name) {
  const sheet = book.Sheets[name];
  if (!sheet) return null;
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  if (range.e.r > maxEntries * 2 || range.e.c > 511) throw new Error("「" + name + "」表范围过大，请删除多余的空行或空列后重试。");
  for (const [address, cell] of Object.entries(sheet)) {
    if (cell?.f) throw new Error("「" + name + "」表的 " + address + " 是公式，请粘贴为文本后重试。");
  }
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1, raw: false, defval: "", blankrows: true, range: {s: {r: 0, c: 0}, e: range.e}
  }).map(row => row.map(value => String(value).trim()));
  const headers = rows.shift() || [];
  const named = headers.filter(Boolean);
  if (new Set(named).size !== named.length) throw new Error("「" + name + "」表包含重复列名。");
  const records = rows.map((cells, index) => ({cells, line: index + 2})).filter(({cells}) => cells.some(Boolean));
  for (const {cells, line} of records) {
    if (cells.some((value, index) => value && !headers[index])) {
      throw new Error("「" + name + "」表第 " + line + " 行有数据填在缺少标题的列。");
    }
  }
  return {headers, records};
}

function importedLanguages(table, existing) {
  if (!table) return existing;
  const {headers, records} = table;
  const codeColumn = headers.indexOf("语言代码");
  const nameColumn = headers.indexOf("显示名称");
  const guideColumn = headers.indexOf("API 翻译要求");
  if (codeColumn < 0 || nameColumn < 0) throw new Error("「语种」表需要「语言代码」和「显示名称」列。");
  const next = new Map(existing.map(item => [item.code, item]));
  const seen = new Set();
  for (const {cells, line} of records) {
    try {
      const code = languageCode(cells[codeColumn]);
      if (seen.has(code)) throw new Error("语言代码重复。");
      seen.add(code);
      if (Object.hasOwn(builtinLanguages, code)) {
        if (cells[nameColumn] !== builtinLanguages[code] || cells[guideColumn]) {
          throw new Error("内置语种请保留导出时的名称和翻译要求。");
        }
        continue;
      }
      next.set(code, customLanguage({
        code, name: cells[nameColumn], guide: guideColumn < 0 ? next.get(code)?.guide : cells[guideColumn]
      }));
    } catch (error) {
      throw new Error("「语种」表第 " + line + " 行：" + error.message);
    }
  }
  const customs = [...next.values()];
  checkLanguageNames(customs);
  return customs;
}

function importLibraryWorkbook(book, state) {
  const phraseTable = workbookTable(book, "话术");
  const languageTable = workbookTable(book, "语种");
  if (!phraseTable && !languageTable) throw new Error("没有找到「话术」或「语种」表。请从软件导出的 Excel 表格开始编辑。");
  const customs = importedLanguages(languageTable, state.customLanguages);
  const names = languageMap(customs);
  const next = new Map(state.entries.map(entry => [entry.id, entry]));
  const oldLanguages = new Map(state.customLanguages.map(item => [item.code, item]));
  const counts = {added: 0, updated: 0, removed: 0, languages: customs.filter(item => {
    const old = oldLanguages.get(item.code);
    return old?.name !== item.name || old?.guide !== item.guide;
  }).length};
  if (phraseTable) {
    const {headers, records} = phraseTable;
    const fields = Object.fromEntries(workbookFields.map(field => [field, headers.indexOf(field)]));
    if (fields["中文原文"] < 0) throw new Error("「话术」表需要「中文原文」列。");
    const localeColumns = new Map();
    headers.forEach((header, column) => {
      if (!header || workbookFields.includes(header)) return;
      const match = /(译文|中文直译)\s*[\[［]([a-z0-9-]+)[\]］]$/iu.exec(header);
      if (!match) throw new Error("无法识别「话术」表中的列「" + header + "」。");
      const code = languageCode(match[2]);
      if (!Object.hasOwn(names, code)) throw new Error("语言代码「" + code + "」未配置，请先在设置或「语种」表添加。");
      const field = match[1] === "译文" ? "translations" : "literal";
      const key = field + ":" + code;
      if (localeColumns.has(key)) throw new Error("「" + code + "」的译文或中文直译列重复。");
      localeColumns.set(key, {field, code, column});
    });

    const seen = new Set();
    const changed = new Map();
    for (const {cells, line} of records) {
      try {
        const value = field => cells[fields[field]] ?? "";
        const providedId = value("词条编号");
        if (providedId && !/^[\w-]{1,64}$/.test(providedId)) throw new Error("词条编号格式无效，请保留原编号或留空新增。");
        const operation = value("操作");
        if (operation && operation !== "删除") throw new Error("「操作」请留空或填写「删除」。");
        const source = value("中文原文");
        const samePhrase = !providedId && source
          ? [...next.values()].filter(entry => normalized(entry.zh) === normalized(source)) : [];
        if (samePhrase.length > 1) throw new Error("词库已有多条相同原句，请填写词条编号。");
        if (operation === "删除" && !providedId) throw new Error("删除话术时请填写词条编号。");
        const id = providedId || samePhrase[0]?.id || newEntryId();
        if (seen.has(id)) throw new Error("同一个词条在表中出现了多次。");
        seen.add(id);
        if (operation === "删除") {
          if (next.delete(id)) counts.removed++;
          continue;
        }
        const old = next.get(id);
        const zh = source || old?.zh || "";
        if (!zh || zh.length > 2000) throw new Error("中文原文须填写 1–2000 字。");
        const category = (fields["分类"] < 0 ? old?.category : value("分类")) || "自定义";
        if (category.length > 24) throw new Error("分类名称最多 24 字。");
        const keywords = fields["关键词"] < 0 ? old?.keywords || [] : parseKeywords(value("关键词"));
        if (keywords.join(", ").length > 300) throw new Error("关键词最多 300 字。");
        const entry = {id, zh, category, keywords, translations: {...old?.translations}, literal: {...old?.literal}};
        for (const {field, code, column} of localeColumns.values()) {
          const content = cells[column] ?? "";
          if (content.length > 4000) throw new Error("「" + headers[column] + "」最多 4000 字。");
          if (content || Object.hasOwn(entry[field], code)) entry[field][code] = content;
        }
        next.set(id, entry);
        if (!old || normalized(zh) !== normalized(old.zh)) changed.set(id, line);
        if (!old) counts.added++;
        else if (JSON.stringify(old) !== JSON.stringify(entry)) counts.updated++;
      } catch (error) {
        throw new Error("「话术」表第 " + line + " 行：" + error.message);
      }
    }
    const totals = new Map();
    for (const entry of next.values()) {
      const key = normalized(entry.zh);
      totals.set(key, (totals.get(key) || 0) + 1);
    }
    for (const [id, line] of changed) {
      if (totals.get(normalized(next.get(id).zh)) > 1) throw new Error("「话术」表第 " + line + " 行的中文原文与另一条重复。");
    }
  }
  if (next.size > maxEntries) throw new Error("导入后词库将超过 " + maxEntries + " 条，请先减少词条。");
  return {entries: [...next.values()], customLanguages: customs, counts};
}
