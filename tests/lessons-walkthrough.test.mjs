import assert from "node:assert/strict";
import test from "node:test";
import { Chess } from "chess.js";
import {
  applyMove,
  kingThreatState,
  legalTargets,
  parseFen,
} from "../assets/chess-engine.mjs";
import { loadLessons } from "../scripts/content-lib.mjs";

const root = process.cwd();

const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

/**
 * 全面走法序列诊断：对每一期内容，用本引擎逐步 replay 整条用户走法 + 对手回应
 * 序列，校验以下不变量（这些是 app.js 运行时 choose() 与对手回应校验所依赖的）：
 *
 *   1. 每一步用户走法在 replay 到的局面上，经 legalTargets 判定为合法；
 *   2. 每一步对手回应（若有）在该局面上同样合法 —— 这是 app.js 新增的运行时
 *      防御校验 legalTargets(state, opponentFrom).includes(opponentTo) 所依赖，
 *      若非法会触发"对手回应异常"提示，因此必须保证所有内容数据通过；
 *   3. errors 字典的 key 是合法 UCI 走法格式（这些 key 会进 UI 走法判定）；
 *   4. alternatives 里的走法在当前局面上合法（会进 UI alt 分支判定）；
 *   5. suggestions 引用的 key 都能在 quick 字典里找到（否则按钮点击无回应）；
 *   6. chess.js 独立 replay 整条序列成功（交叉验证本引擎与标准库一致）。
 *
 * 这条测试是 7/29"卡住"反馈的直接回归保护：任何让某期对手回应在本引擎下
 * 变非法的改动（引擎 bug、内容数据错误）都会在此立即暴露。
 */
test("every lesson: user moves, opponent replies, alternatives all legal under our engine", async () => {
  const lessons = await loadLessons(root);
  assert.ok(lessons.length > 0, "should load at least one lesson");

  for (const lesson of lessons) {
    const c = lesson.challenge;
    let state = parseFen(c.fen);

    for (let i = 0; i < c.steps.length; i++) {
      const step = c.steps[i];
      const userFrom = step.move.slice(0, 2);
      const userTo = step.move.slice(2, 4);

      // (1) 用户走法合法
      assert.ok(
        legalTargets(state, userFrom).includes(userTo),
        `${lesson.slug} step ${i}: 用户走法 ${step.move} 在本引擎下不合法`
      );
      state = applyMove(state, step.move);

      // (2) 对手回应合法 —— 运行时防御校验依赖这个不变量
      if (step.opponent) {
        const oppFrom = step.opponent.slice(0, 2);
        const oppTo = step.opponent.slice(2, 4);
        assert.ok(
          legalTargets(state, oppFrom).includes(oppTo),
          `${lesson.slug} step ${i}: 对手回应 ${step.opponent} 在本引擎下不合法（运行时校验会触发"对手回应异常"）`
        );
        state = applyMove(state, step.opponent);
      }

      // (4) alternatives 走法在该局面合法
      if (step.alternatives) {
        // alternatives 是在用户走该步之前的局面判定，需要回到走该步前的状态。
        // 这里重新 replay 到 step i 起始局面来校验。
        let altState = parseFen(c.fen);
        for (let j = 0; j < i; j++) {
          altState = applyMove(altState, c.steps[j].move);
          if (c.steps[j].opponent) altState = applyMove(altState, c.steps[j].opponent);
        }
        for (const alt of step.alternatives) {
          const aFrom = alt.move.slice(0, 2);
          const aTo = alt.move.slice(2, 4);
          assert.ok(
            UCI_RE.test(alt.move),
            `${lesson.slug} step ${i} alternative ${alt.move} 不是合法 UCI 格式`
          );
          assert.ok(
            legalTargets(altState, aFrom).includes(aTo),
            `${lesson.slug} step ${i} alternative ${alt.move} 在该局面不合法`
          );
        }
      }
    }

    // (3) errors 字典 key 是合法 UCI
    if (c.errors) {
      for (const key of Object.keys(c.errors)) {
        assert.ok(
          UCI_RE.test(key),
          `${lesson.slug}: errors 字典 key "${key}" 不是合法 UCI 走法格式`
        );
      }
    }

    // (5) suggestions 引用的 key 都在 quick 里
    if (c.suggestions && c.quick) {
      for (const s of c.suggestions) {
        assert.ok(
          c.quick[s.key] !== undefined,
          `${lesson.slug}: suggestion key "${s.key}" 在 quick 字典里找不到`
        );
      }
    }

    // (6) chess.js 独立 cross-validate 整条序列
    const game = new Chess(c.fen);
    for (const step of c.steps) {
      game.move({ from: step.move.slice(0, 2), to: step.move.slice(2, 4), promotion: step.move[4] });
      if (step.opponent) {
        game.move({ from: step.opponent.slice(0, 2), to: step.opponent.slice(2, 4), promotion: step.opponent[4] });
      }
    }
  }
});

/**
 * 完成态一致性：app.js 在最后一步走对后用 kingThreatState(state, "b") 决定庆祝文案
 * 与黑王动画。这里断言本引擎算出的最终威胁状态与 chess.js 的 checkmate/check 结论
 * 一致，避免两个引擎在"是否将杀"上出现分歧（会导致庆祝文案与实际局面矛盾）。
 */
test("every lesson: our kingThreatState agrees with chess.js on the final position", async () => {
  const lessons = await loadLessons(root);

  for (const lesson of lessons) {
    const c = lesson.challenge;
    // 本引擎 replay 到最终
    let state = parseFen(c.fen);
    for (const step of c.steps) {
      state = applyMove(state, step.move);
      if (step.opponent) state = applyMove(state, step.opponent);
    }
    const ourThreat = kingThreatState(state, "b");

    // chess.js replay 到最终
    const game = new Chess(c.fen);
    for (const step of c.steps) {
      game.move({ from: step.move.slice(0, 2), to: step.move.slice(2, 4), promotion: step.move[4] });
      if (step.opponent) {
        game.move({ from: step.opponent.slice(0, 2), to: step.opponent.slice(2, 4), promotion: step.opponent[4] });
      }
    }

    if (ourThreat === "checkmate") {
      assert.ok(game.isCheckmate(), `${lesson.slug}: 本引擎判 checkmate 但 chess.js 不认`);
    } else if (ourThreat === "check") {
      assert.ok(!game.isCheckmate() && game.inCheck(), `${lesson.slug}: 本引擎判 check 但 chess.js 不认`);
    } else {
      // ourThreat === "none"：chess.js 也不应是 checkmate（将杀课必须被本引擎识别）
      assert.ok(!game.isCheckmate(), `${lesson.slug}: chess.js 判 checkmate 但本引擎判 ${ourThreat}`);
    }
  }
});
