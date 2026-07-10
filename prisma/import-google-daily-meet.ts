/**
 * Import "TRR OutDev - daily meet กรกฎาคม 2026" Google Sheet into DevPulse.
 *
 * Reads every developer tab (Boss, Pond, Jame, Gun, Golf, Pang) as CSV via the
 * public gviz endpoint (no credentials needed — the sheet is link-viewable),
 * parses the repeated Date → Done/Doing/Todo → task-rows block structure, and
 * upserts real Users, one Project, DailyReports (one per user per date) and
 * Tasks (one per task row).
 *
 * Idempotent: re-running never duplicates. Natural-key matching is used since
 * the schema has no dedicated "source" column — the TRR OutDev *project* is the
 * source marker (all imported reports/tasks belong to it):
 *   - User    → unique email
 *   - Project → unique code (TRR-OUTDEV)
 *   - Report  → (authorId, projectId, date)
 *   - Task    → (projectId, assigneeId, title, dueDate)
 *
 * Duplicate date blocks (e.g. 7/9/2026 appears twice on Jame/Pang, 7/6 on Boss)
 * are MERGED: tasks within the same (user, date) are keyed by title, so a
 * repeated block adds new titles and the latest occurrence of a repeated title
 * wins (its status/progress/note). No duplicate task titles per user/date.
 *
 * Flags:
 *   --replace   delete existing TRR OutDev reports+tasks (this source only)
 *               before re-importing. Never touches other projects' data or users.
 *
 * Run:  DATABASE_URL=... npm run import:daily-meet [-- --replace]
 */
import "dotenv/config";
import { PrismaClient, type TaskStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import Papa from "papaparse";

const prisma = new PrismaClient();

const SHEET_ID = "1Timhck4r8NpERy89-nAENK8UvLCW7EG23ezzJjLMaOM";
const TABS = ["Boss", "Pond", "Jame", "Gun", "Golf", "Pang"];
const PROJECT = { name: "TRR OutDev", code: "TRR-OUTDEV", color: "#0d9488" };
const DEFAULT_PASSWORD = "password123";
const REPLACE = process.argv.includes("--replace");

// Notes/tasks containing any of these are surfaced as report blockers.
const BLOCKER_KEYWORDS = [
  "wait",
  "hold",
  "ติดปัญหา",
  "รอรีวิว",
  "รอข้อมูล",
  "wait api",
  "got api",
];

type Section = "Done" | "Doing" | "Todo";
type TaskInfo = { title: string; section: Section; progress: number | null; note: string };
type Block = { date: Date; order: number; tasks: Map<string, TaskInfo> };

/* ------------------------------ helpers -------------------------------- */

async function fetchTabCsv(tab: string): Promise<string[][]> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch tab "${tab}": HTTP ${res.status}`);
  const csv = await res.text();
  const parsed = Papa.parse<string[]>(csv, { skipEmptyLines: false });
  return parsed.data.map((row) => row.map((c) => (c ?? "").trim()));
}

/** "7/1/2026" (M/D/YYYY) → UTC-midnight Date, else null. */
function parseDate(s: string): Date | null {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return new Date(Date.UTC(+yyyy, +mm - 1, +dd));
}

function normalizeSection(d: string): Section | null {
  const x = d.toLowerCase().replace(/[\s-]/g, "");
  if (x === "done") return "Done";
  if (x === "doing" || x === "inprogress") return "Doing";
  if (x === "todo") return "Todo";
  return null;
}

function parseProgress(f: string): number | null {
  if (!f) return null;
  const n = parseInt(f.replace(/[^\d]/g, ""), 10);
  return Number.isNaN(n) ? null : n;
}

function taskStatus(section: Section, progress: number | null): TaskStatus {
  if (section === "Done") return progress !== null && progress < 100 ? "IN_PROGRESS" : "DONE";
  if (section === "Doing") return "IN_PROGRESS";
  return "TODO";
}

function isBlocker(text: string): boolean {
  const t = text.toLowerCase();
  return !!text && BLOCKER_KEYWORDS.some((k) => t.includes(k.toLowerCase()));
}

function taskDescription(t: TaskInfo): string {
  const parts: string[] = [];
  if (t.progress !== null) parts.push(`Progress: ${t.progress}%`);
  if (t.note) parts.push(`Note: ${t.note}`);
  return parts.join("\n");
}

/** Parse one tab's rows into merged (date → tasks) blocks. */
function parseTab(rows: string[][]): Block[] {
  const blocks = new Map<string, Block>();
  let curDate: Date | null = null;
  let curSection: Section | null = null;

  for (let i = 1; i < rows.length; i++) {
    const b = rows[i][1] ?? "";
    const d = rows[i][3] ?? "";
    const e = rows[i][4] ?? "";
    const f = rows[i][5] ?? "";
    const g = rows[i][6] ?? "";

    const dt = parseDate(b);
    if (dt) {
      // New (or repeated) date block. Keep an existing block for the same date
      // so repeated date sections merge into it.
      curDate = dt;
      curSection = normalizeSection(d);
      const key = dt.toISOString();
      if (!blocks.has(key)) blocks.set(key, { date: dt, order: blocks.size, tasks: new Map() });
      continue; // E/F/G on a date row are the literal "Task"/"%"/"Note" labels
    }

    const section = normalizeSection(d);
    if (section) {
      curSection = section;
      continue; // status-header row — E/F/G are labels
    }

    // Task row.
    if (e && e.toLowerCase() !== "task" && curDate && curSection) {
      const block = blocks.get(curDate.toISOString());
      if (!block) continue;
      block.tasks.set(e, { title: e, section: curSection, progress: parseProgress(f), note: g });
    }
  }

  return [...blocks.values()].sort((a, b) => a.order - b.order);
}

/* ------------------------------ upserts -------------------------------- */

async function upsertUser(tab: string, passwordHash: string) {
  const email = `${tab.toLowerCase()}@devpulse.io`;
  return prisma.user.upsert({
    where: { email },
    update: { name: tab, avatarKey: tab, active: true },
    create: {
      name: tab,
      email,
      password: passwordHash,
      role: "DEVELOPER",
      avatarKey: tab,
      active: true,
    },
  });
}

async function upsertReport(
  authorId: string,
  projectId: string,
  date: Date,
  data: { summary: string; did: string; blockers: string; plan: string }
) {
  const existing = await prisma.dailyReport.findFirst({ where: { authorId, projectId, date } });
  const payload = { ...data, status: "SUBMITTED" as const };
  if (existing) {
    await prisma.dailyReport.update({ where: { id: existing.id }, data: payload });
    return false; // updated
  }
  await prisma.dailyReport.create({ data: { authorId, projectId, date, ...payload } });
  return true; // created
}

async function upsertTask(
  projectId: string,
  assigneeId: string,
  title: string,
  dueDate: Date,
  data: { description: string; status: TaskStatus }
) {
  const existing = await prisma.task.findFirst({
    where: { projectId, assigneeId, title, dueDate },
  });
  const payload = { ...data, priority: "MEDIUM" as const };
  if (existing) {
    await prisma.task.update({ where: { id: existing.id }, data: payload });
    return false;
  }
  await prisma.task.create({ data: { projectId, assigneeId, title, dueDate, ...payload } });
  return true;
}

/* -------------------------------- main --------------------------------- */

async function main() {
  console.log(`📥 Importing TRR OutDev daily meet${REPLACE ? " (--replace mode)" : ""}…`);

  const project = await prisma.project.upsert({
    where: { code: PROJECT.code },
    update: { name: PROJECT.name, color: PROJECT.color },
    create: PROJECT,
  });

  if (REPLACE) {
    const t = await prisma.task.deleteMany({ where: { projectId: project.id } });
    const r = await prisma.dailyReport.deleteMany({ where: { projectId: project.id } });
    console.log(`🧹 --replace: removed ${r.count} reports, ${t.count} tasks for ${PROJECT.code}`);
  }

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  const stats = {
    usersUpserted: 0,
    reportsCreated: 0,
    reportsUpdated: 0,
    tasksCreated: 0,
    tasksUpdated: 0,
    skippedEmptyBlocks: [] as string[],
  };

  for (const tab of TABS) {
    const rows = await fetchTabCsv(tab);
    const blocks = parseTab(rows);

    const user = await upsertUser(tab, passwordHash);
    stats.usersUpserted++;

    let tabReports = 0;
    let tabTasks = 0;

    for (const block of blocks) {
      const tasks = [...block.tasks.values()];
      const dateLabel = block.date.toISOString().slice(0, 10);

      if (tasks.length === 0) {
        stats.skippedEmptyBlocks.push(`${tab} ${dateLabel}`);
        continue; // date block with no tasks in Done/Doing/Todo → nothing to record
      }

      const done = tasks.filter((t) => t.section === "Done");
      const plan = tasks.filter((t) => t.section === "Doing" || t.section === "Todo");
      const didText = done.map((t) => `• ${t.title}`).join("\n") || "—";
      const planText = plan.map((t) => `• ${t.title}`).join("\n") || "—";
      const blockers = tasks
        .map((t) => t.note)
        .filter((n) => isBlocker(n))
        .join("\n");
      const summarySrc = (done[0] ?? plan[0])?.title ?? "—";
      const summary = summarySrc.length > 80 ? summarySrc.slice(0, 79) + "…" : summarySrc;

      const created = await upsertReport(user.id, project.id, block.date, {
        summary,
        did: didText,
        blockers,
        plan: planText,
      });
      created ? stats.reportsCreated++ : stats.reportsUpdated++;
      tabReports++;

      for (const t of tasks) {
        const madeTask = await upsertTask(project.id, user.id, t.title, block.date, {
          description: taskDescription(t),
          status: taskStatus(t.section, t.progress),
        });
        madeTask ? stats.tasksCreated++ : stats.tasksUpdated++;
        tabTasks++;
      }
    }

    console.log(`  ${tab}: ${blocks.length} date blocks → ${tabReports} reports, ${tabTasks} tasks`);
  }

  console.log("\n✅ Import complete");
  console.log(`   users upserted:   ${stats.usersUpserted}`);
  console.log(`   reports created:  ${stats.reportsCreated} (updated ${stats.reportsUpdated})`);
  console.log(`   tasks created:    ${stats.tasksCreated} (updated ${stats.tasksUpdated})`);
  if (stats.skippedEmptyBlocks.length) {
    console.log(
      `   skipped ${stats.skippedEmptyBlocks.length} empty date blocks (no tasks): ${stats.skippedEmptyBlocks.join(", ")}`
    );
  }
}

main()
  .catch((e) => {
    console.error("❌ Import failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
