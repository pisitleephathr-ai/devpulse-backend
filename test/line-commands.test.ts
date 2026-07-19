import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchTextCommand,
  isBotCommand,
  BOT_COMMANDS,
  parseCloseCommand,
  parseMemberCommand,
} from "../src/lib/line-commands";

// matchTextCommand is pure keyword matching; the command handlers hit the DB and
// are exercised end-to-end on the live LINE OA.

test("matchTextCommand: Thai keywords map to the right command", () => {
  assert.equal(matchTextCommand("งานของฉัน"), "my_tasks");
  assert.equal(matchTextCommand("งานเลยกำหนดของฉัน"), "my_overdue");
  assert.equal(matchTextCommand("งานครบกำหนดวันนี้"), "due_today");
  assert.equal(matchTextCommand("ใครลาวันนี้"), "leave_today");
  assert.equal(matchTextCommand("สถานะรายงานวันนี้"), "report_today");
  assert.equal(matchTextCommand("เมนู"), "help");
});

test("matchTextCommand: English + greetings", () => {
  assert.equal(matchTextCommand("overdue"), "my_overdue");
  assert.equal(matchTextCommand("due"), "due_today");
  assert.equal(matchTextCommand("leave"), "leave_today");
  assert.equal(matchTextCommand("report"), "report_today");
  assert.equal(matchTextCommand("help"), "help");
  assert.equal(matchTextCommand("สวัสดี"), "help");
});

test("matchTextCommand: specificity — overdue/due beat the generic 'งาน'", () => {
  // "เลยกำหนด" / "ครบกำหนด" must win over the plain "งาน" → my_tasks rule.
  assert.equal(matchTextCommand("เลยกำหนด"), "my_overdue");
  assert.equal(matchTextCommand("ครบกำหนด"), "due_today");
});

test("matchTextCommand: unknown text returns null", () => {
  assert.equal(matchTextCommand("xyz random"), null);
  assert.equal(matchTextCommand("   "), null);
});

test("parseCloseCommand: extracts the task name after เสร็จ/ปิดงาน/done", () => {
  assert.equal(parseCloseCommand("เสร็จ ทำหน้า login"), "ทำหน้า login");
  assert.equal(parseCloseCommand("ปิดงาน แก้บั๊ก"), "แก้บั๊ก");
  assert.equal(parseCloseCommand("done fix header"), "fix header");
  assert.equal(parseCloseCommand("เสร็จแล้ว"), null); // no task name
  assert.equal(parseCloseCommand("งานของฉัน"), null);
});

test("parseMemberCommand: extracts a member name, ignores self", () => {
  assert.equal(parseMemberCommand("งานของสมชาย"), "สมชาย");
  assert.equal(parseMemberCommand("งานของ James"), "James");
  assert.equal(parseMemberCommand("งานของฉัน"), null); // self → my_tasks
  assert.equal(parseMemberCommand("งานของ ผม"), null);
  assert.equal(parseMemberCommand("งานเลยกำหนด"), null);
});

test("every command matchTextCommand can return is a valid BotCommand", () => {
  for (const c of ["my_tasks", "my_overdue", "due_today", "leave_today", "report_today", "help"]) {
    assert.ok(isBotCommand(c), `${c} should be a bot command`);
  }
  assert.equal(BOT_COMMANDS.length, 6);
});
