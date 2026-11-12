const fs = require("node:fs");
const assert = require("node:assert/strict");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const readSource = (name) => fs.readFileSync(path.join(root, "src", name), "utf8");
const codes = ["en", "ja", "ko", "es", "pt", "de", "fr", "it", "ru"];
const glosses = new Map(readSource("glosses.txt").trim().split("\n").map(line => {
  const [id, code, gloss] = line.split("|");
  return [id + ":" + code, gloss];
}));
const rows = readSource("phrases.txt").trim().split("\n").map((line, i) => {
  const [id, category, zh, keywordList, gloss, ...foreign] = line.split("|");
  assert.equal(Number(id), i + 1);
  assert.equal(foreign.length, codes.length, "译文数量不正确: " + id);
  assert.ok([category, zh, keywordList, gloss, ...foreign].every(value => value.trim()), "词库缺字段: " + id);
  return {
    id: "base-" + id, category, zh, keywords: keywordList.split(";"),
    translations: Object.fromEntries(codes.map((code, n) => [code, foreign[n]])),
    literal: Object.fromEntries(codes.map(code => [code, glosses.get(id + ":" + code) ?? gloss]))
  };
});
assert.equal(new Set(rows.map(row => row.zh)).size, rows.length);
assert.ok(rows.every(row => Object.entries(row.translations).every(([code, text]) => code === "ja" || !/\p{Script=Han}/u.test(text))));
const seed = JSON.stringify(rows, null, 2).replace(/</g, "\\u003c");
const legacy = readSource("legacy.json");
const script = readSource("app.js");
const shell = readSource("shell.html");
const xlsx = fs.readFileSync(path.join(root, "vendor", "sheetjs", "xlsx.mini.min.js"), "utf8");
assert.ok(!/<\/script/i.test(xlsx), "SheetJS script cannot be inlined as-is");
const scripts = '<script>\n' + xlsx + '\n</script>\n' +
  '<script id="builtin-data" type="application/json">\n' + seed + '\n</script>\n' +
  '<script id="legacy-data" type="application/json">\n' + legacy + '\n</script>\n' +
  '<script>\n' + readSource("workbook.js") + '</script>\n' +
  '<script>\n' + script + '</script>\n';
fs.writeFileSync(path.join(root, "客服语气翻译器.html"), shell.replace("</body>", () => scripts + "</body>"));
console.log(rows.length + " phrases × " + codes.length + " languages, with corresponding Chinese glosses");
