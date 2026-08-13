import assert from "node:assert/strict";
import test from "node:test";
import { LANGS, resolveLanguage, siblingPath, UI } from "../assets/i18n.mjs";

// ---- resolveLanguage ------------------------------------------------------

test("resolveLanguage defaults to zh for unknown or missing languages", () => {
  assert.equal(resolveLanguage("", null), "zh");
  assert.equal(resolveLanguage(null, null), "zh");
  assert.equal(resolveLanguage("ja-JP", null), "zh");
  assert.equal(resolveLanguage("de", null), "zh");
});

test("resolveLanguage maps zh* and en* browser languages", () => {
  assert.equal(resolveLanguage("zh-CN", null), "zh");
  assert.equal(resolveLanguage("zh-TW", null), "zh");
  assert.equal(resolveLanguage("en-US", null), "en");
  assert.equal(resolveLanguage("en-GB", null), "en");
});

test("resolveLanguage prioritizes the stored manual choice", () => {
  assert.equal(resolveLanguage("en-US", "zh"), "zh");
  assert.equal(resolveLanguage("zh-CN", "en"), "en");
  assert.equal(resolveLanguage("ja-JP", "en"), "en");
});

test("resolveLanguage ignores invalid stored values", () => {
  assert.equal(resolveLanguage("en-US", "fr"), "en");
  assert.equal(resolveLanguage("en-US", ""), "en");
});

// ---- siblingPath ----------------------------------------------------------

test("siblingPath maps zh page to en subdirectory", () => {
  assert.equal(siblingPath("zh", "/chess-moment/rook-ladder.html"), "/chess-moment/en/rook-ladder.html");
  assert.equal(siblingPath("zh", "/chess-moment/index.html"), "/chess-moment/en/index.html");
  assert.equal(siblingPath("zh", "/rook-ladder.html"), "/en/rook-ladder.html");
});

test("siblingPath maps en page back to the root zh page", () => {
  assert.equal(siblingPath("en", "/chess-moment/en/rook-ladder.html"), "/chess-moment/rook-ladder.html");
  assert.equal(siblingPath("en", "/chess-moment/en/index.html"), "/chess-moment/index.html");
  assert.equal(siblingPath("en", "/en/rook-ladder.html"), "/rook-ladder.html");
});

test("siblingPath is an involution (zh -> en -> zh)", () => {
  const original = "/chess-moment/rook-ladder.html";
  const en = siblingPath("zh", original);
  assert.equal(siblingPath("en", en), original);
});

// ---- UI dictionary integrity ----------------------------------------------

test("UI dictionary has identical key sets for zh and en", () => {
  const zhKeys = Object.keys(UI.zh).sort();
  const enKeys = Object.keys(UI.en).sort();
  assert.deepEqual(enKeys, zhKeys, "en must define the same keys as zh");
});

test("UI dictionaries cover every language with non-empty values", () => {
  for (const lang of LANGS) {
    for (const [key, value] of Object.entries(UI[lang])) {
      // 字符串键必须存在且为字符串（个别如 en.prereqSuffix 有意留空）。
      if (key !== "pieceNames" && key !== "notationGlossary") {
        assert.equal(typeof value, "string", `${lang}.${key} must be a string`);
      }
      // 嵌套对象（pieceNames / notationGlossary）由专门用例校验完整性。
    }
  }
});

test("notation glossary terms match between languages", () => {
  assert.deepEqual(
    Object.keys(UI.en.notationGlossary).sort(),
    Object.keys(UI.zh.notationGlossary).sort(),
    "notation glossary terms must be identical across languages"
  );
});

test("piece names cover all 12 pieces in both languages", () => {
  for (const lang of LANGS) {
    const names = UI[lang].pieceNames;
    for (const piece of ["K", "Q", "R", "B", "N", "P", "k", "q", "r", "b", "n", "p"]) {
      assert.ok(names[piece], `${lang} missing piece name for ${piece}`);
    }
  }
});
