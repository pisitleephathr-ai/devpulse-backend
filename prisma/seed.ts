import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/** Fixed reference month for the sample data: July 2026. */
const d = (iso: string) => new Date(`${iso}T09:00:00.000Z`);

async function main() {
  // Safety guard: this seed DELETES every table before inserting demo data
  // with a shared, well-known password. Never let it run against production by
  // accident (DEPLOYMENT previously documented seeding the live DB directly).
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_SEED !== "1") {
    throw new Error(
      "Refusing to seed: NODE_ENV=production. This wipes ALL data and creates demo " +
        "accounts with a shared password. Set ALLOW_PROD_SEED=1 only if you truly " +
        "intend to reset production."
    );
  }
  console.log("🌱 Seeding DevPulse…");

  // Clean in dependency order (safe to re-run).
  await prisma.activityLog.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.task.deleteMany();
  await prisma.dailyReport.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();
  await prisma.calendarEvent.deleteMany();
  await prisma.leaveTypePolicy.deleteMany();
  await prisma.teamSetting.deleteMany();

  const password = await bcrypt.hash("password123", 10);

  /* ------------------------------- Users ------------------------------ */
  const usersSeed = [
    { name: "เลนา ฮอฟฟ์แมน", email: "lena@devpulse.io", role: "MANAGER", avatarKey: "Lena", active: true },
    { name: "ดานา คิม", email: "dana@devpulse.io", role: "ADMIN", avatarKey: "Dana", active: true },
    { name: "มายา เฉิน", email: "maya@devpulse.io", role: "DEVELOPER", avatarKey: "Maya", active: true },
    { name: "โจนาส เวเบอร์", email: "jonas@devpulse.io", role: "DEVELOPER", avatarKey: "Jonas", active: true },
    { name: "ปรียา นาอีร์", email: "priya@devpulse.io", role: "DEVELOPER", avatarKey: "Priya", active: true },
    { name: "ทอม โอคาฟอร์", email: "tom@devpulse.io", role: "DEVELOPER", avatarKey: "Tom", active: true },
    { name: "ซาร่า ลินด์ควิสต์", email: "sara@devpulse.io", role: "QA", avatarKey: "Sara", active: true },
    { name: "อเล็กซ์ รุยซ์", email: "alex@devpulse.io", role: "DEVELOPER", avatarKey: "Alex", active: true },
    { name: "เบน คาร์เตอร์", email: "ben@devpulse.io", role: "DEVELOPER", avatarKey: "Ben", active: false },
  ] as const;

  const users: Record<string, string> = {};
  for (const u of usersSeed) {
    const created = await prisma.user.create({ data: { ...u, password } });
    users[u.avatarKey] = created.id;
  }

  /* ------------------------------ Projects ---------------------------- */
  const projectsSeed = [
    { name: "Atlas API", code: "ATLAS", color: "#0f766e" },
    { name: "Orbit Mobile", code: "ORBIT", color: "#b45309" },
    { name: "Console Redesign", code: "CONSOLE", color: "#7c3aed" },
    { name: "Infra Hardening", code: "INFRA", color: "#be123c" },
  ] as const;

  const projects: Record<string, string> = {};
  for (const p of projectsSeed) {
    const created = await prisma.project.create({ data: p });
    projects[p.code] = created.id;
  }

  /* --------------------------- Daily reports -------------------------- */
  const reportsSeed = [
    { key: "Maya", proj: "CONSOLE", date: "2026-07-09", status: "SUBMITTED", summary: "ทำกราฟแดชบอร์ด v2 เสร็จ รีวิว PR หน้า onboarding", did: "ทำกราฟแดชบอร์ด v2 เสร็จและเปิดใช้หลัง feature flag แล้ว รีวิว PR เช็กลิสต์ onboarding ของปรียา และทำงานร่วมกับซาร่าเรื่องแผน QA สำหรับรีลีส 2.4", blockers: "วันนี้ไม่มี", plan: "เริ่มทำ empty state ของหน้ารายการรายงาน จากนั้นทำ responsive ให้แถบเมนูด้านข้าง" },
    { key: "Jonas", proj: "ATLAS", date: "2026-07-09", status: "SUBMITTED", summary: "ทำ OAuth refresh flow; ติดเรื่องสิทธิ์เข้าฐานข้อมูล Staging", did: "พัฒนาเส้นทาง token refresh ของ OAuth flow และเพิ่ม integration test สำหรับกรณี token หมดอายุ", blockers: "ติดเรื่องสิทธิ์เข้าถึงฐานข้อมูล Staging — สิทธิ์ถูกยกเลิกตอน rotation รอบล่าสุด เปิดตั๋วแจ้ง IT ตั้งแต่ 9 โมงเช้า", plan: "ทำ refresh flow ให้เสร็จเมื่อได้สิทธิ์คืน ระหว่างนี้เริ่มเขียน design doc เรื่อง rate limiting" },
    { key: "Priya", proj: "ATLAS", date: "2026-07-09", status: "SUBMITTED", summary: "ตรวจสอบคำขอลาอยู่ในขั้นรีวิว ส่งออก CSV เสร็จแล้ว", did: "ปล่อยฟีเจอร์ส่งออกรายงานเป็น CSV แล้ว ย้ายงานตรวจสอบคำขอลาเข้าขั้นรีวิวและแก้คอมเมนต์รอบแรกแล้ว", blockers: "ไม่มี", plan: "แก้คอมเมนต์รีวิวที่เหลือ จากนั้นช่วยโจนาสเรื่อง rate limiting" },
    { key: "Tom", proj: "ORBIT", date: "2026-07-09", status: "SUBMITTED", summary: "ทำ Push Notification ฝั่ง Android; รอใบรับรอง", did: "ต่อระบบ FCM สำหรับ Push Notification ฝั่ง Android และทำหน้าตั้งค่าการแจ้งเตือนเสร็จแล้ว", blockers: "รอใบรับรอง Push จากดานา — ยังทดสอบบนเครื่องจริงไม่ได้จนกว่าจะได้รับ", plan: "ทดสอบ push แบบ end-to-end เมื่อได้ใบรับรอง แล้วเริ่มทำฝั่ง iOS ให้เท่ากัน" },
    { key: "Alex", proj: "INFRA", date: "2026-07-09", status: "SUBMITTED", summary: "ปรับ CI cache เสร็จ เวลา build ลดลง 40%", did: "ปรับแต่ง CI cache เสร็จ — เวลา build เฉลี่ยลดลง 40% และลบ Terraform module ที่ไม่ใช้แล้ว 2 ตัว", blockers: "ไม่มี", plan: "เก็บกวาด Terraform module ต่อ และช่วยดูตั๋วเรื่องสิทธิ์ Staging ของโจนาส" },
    { key: "Sara", proj: "CONSOLE", date: "2026-07-09", status: "DRAFT", summary: "ฉบับร่าง — กำลังเขียนแผน QA สำหรับ 2.4", did: "กำลังร่างแผน QA สำหรับรีลีส 2.4 คัดกรอง regression suite ไปได้ประมาณครึ่งทาง", blockers: "—", plan: "—" },
    { key: "Maya", proj: "CONSOLE", date: "2026-07-08", status: "SUBMITTED", summary: "ทำ tooltip ของกราฟ และตรวจ a11y ของเมนู", did: "ทำ tooltip ของกราฟ และตรวจ accessibility ของเมนูด้านข้าง", blockers: "ไม่มี", plan: "ทำกราฟ v2 ให้เสร็จ" },
    { key: "Jonas", proj: "ATLAS", date: "2026-07-08", status: "LATE", summary: "วางโครง OAuth flow และ migrate schema", did: "วางโครงสร้างสำหรับ OAuth refresh flow และรัน migration ของ schema sessions บน Staging", blockers: "ไม่มี", plan: "ทำเส้นทาง token refresh" },
  ] as const;

  for (const r of reportsSeed) {
    await prisma.dailyReport.create({
      data: {
        authorId: users[r.key],
        projectId: projects[r.proj],
        date: d(r.date),
        summary: r.summary,
        did: r.did,
        blockers: r.blockers,
        plan: r.plan,
        status: r.status,
      },
    });
  }

  /* ------------------------------- Tasks ------------------------------ */
  const tasksSeed = [
    { title: "Rate limiting สำหรับ Public API", proj: "ATLAS", key: "Jonas", pri: "HIGH", due: "2026-07-14", status: "TODO" },
    { title: "Empty state หน้ารายการรายงาน", proj: "CONSOLE", key: "Maya", pri: "LOW", due: "2026-07-18", status: "TODO" },
    { title: "แผน QA สำหรับรีลีส 2.4", proj: "CONSOLE", key: "Sara", pri: "MEDIUM", due: "2026-07-16", status: "TODO" },
    { title: "OAuth token refresh flow", proj: "ATLAS", key: "Jonas", pri: "HIGH", due: "2026-07-10", status: "IN_PROGRESS" },
    { title: "กราฟแดชบอร์ด v2", proj: "CONSOLE", key: "Maya", pri: "MEDIUM", due: "2026-07-15", status: "IN_PROGRESS" },
    { title: "Push Notification (Android)", proj: "ORBIT", key: "Tom", pri: "HIGH", due: "2026-07-11", status: "IN_PROGRESS" },
    { title: "เก็บกวาด Terraform module", proj: "INFRA", key: "Alex", pri: "LOW", due: "2026-07-21", status: "IN_PROGRESS" },
    { title: "ตรวจสอบคำขอลา (validation)", proj: "ATLAS", key: "Priya", pri: "MEDIUM", due: "2026-07-09", status: "REVIEW" },
    { title: "UI เช็กลิสต์ onboarding", proj: "CONSOLE", key: "Maya", pri: "LOW", due: "2026-07-09", status: "REVIEW" },
    { title: "ปรับแต่ง CI cache", proj: "INFRA", key: "Alex", pri: "MEDIUM", due: "2026-07-08", status: "DONE" },
    { title: "ส่งออกรายงานเป็น CSV", proj: "ATLAS", key: "Priya", pri: "LOW", due: "2026-07-07", status: "DONE" },
  ] as const;

  for (const t of tasksSeed) {
    await prisma.task.create({
      data: {
        title: t.title,
        projectId: projects[t.proj],
        assigneeId: users[t.key] ?? null,
        priority: t.pri,
        status: t.status,
        dueDate: d(t.due),
      },
    });
  }

  /* --------------------------- Leave requests ------------------------- */
  const lena = users["Lena"];
  const leavesSeed = [
    { key: "Tom", type: "VACATION", start: "2026-07-20", end: "2026-07-24", days: 5, reason: "ไปเที่ยวกับครอบครัวที่ลิสบอน", status: "APPROVED", reviewer: lena },
    { key: "Priya", type: "PERSONAL", start: "2026-07-15", end: "2026-07-15", days: 1, reason: "ย้ายที่อยู่", status: "PENDING", reviewer: null },
    { key: "Jonas", type: "VACATION", start: "2026-08-03", end: "2026-08-14", days: 10, reason: "พักร้อนช่วงฤดูร้อน", status: "PENDING", reviewer: null },
    { key: "Maya", type: "PERSONAL", start: "2026-07-31", end: "2026-07-31", days: 1, reason: "นัดพบแพทย์", status: "PENDING", reviewer: null },
    { key: "Sara", type: "SICK", start: "2026-07-08", end: "2026-07-08", days: 1, reason: "ไข้หวัด", status: "APPROVED", reviewer: lena },
    { key: "Alex", type: "PERSONAL", start: "2026-06-30", end: "2026-06-30", days: 1, reason: "ติดต่อราชการ", status: "REJECTED", reviewer: lena },
  ] as const;

  for (const l of leavesSeed) {
    await prisma.leaveRequest.create({
      data: {
        userId: users[l.key],
        type: l.type,
        startDate: d(l.start),
        endDate: d(l.end),
        days: l.days,
        reason: l.reason,
        status: l.status,
        reviewedById: l.reviewer,
      },
    });
  }

  /* --------------------------- Activity log --------------------------- */
  const now = Date.now();
  const ago = (mins: number) => new Date(now - mins * 60_000);
  const activitySeed = [
    { key: "Priya", action: "task.status", message: 'ปรียา นาอีร์ ย้าย "ตรวจสอบคำขอลา" ไปขั้นรอรีวิว', at: ago(24) },
    { key: "Alex", action: "task.status", message: 'อเล็กซ์ รุยซ์ ทำ "ปรับแต่ง CI cache" เสร็จแล้ว', at: ago(60) },
    { key: "Tom", action: "report.blocker", message: "ทอม โอคาฟอร์ รายงานอุปสรรคในโปรเจกต์ Orbit Mobile", at: ago(120) },
    { key: "Jonas", action: "report.create", message: "โจนาส เวเบอร์ ส่งรายงานประจำวันแล้ว", at: ago(180) },
    { key: "Maya", action: "leave.create", message: "มายา เฉิน ขอลากิจวันที่ 31 ก.ค.", at: ago(240) },
    { key: "Sara", action: "task.comment", message: 'ซาร่า ลินด์ควิสต์ คอมเมนต์ใน "แผน QA สำหรับรีลีส 2.4"', at: ago(1440) },
  ] as const;

  for (const a of activitySeed) {
    await prisma.activityLog.create({
      data: {
        userId: users[a.key],
        action: a.action,
        message: a.message,
        createdAt: a.at,
      },
    });
  }

  /* --------------------------- Calendar events ------------------------ */
  const calendarSeed = [
    { title: "ซาร่า · ลาป่วย", start: "2026-07-08", end: "2026-07-08", type: "LEAVE" },
    { title: "OAuth ครบกำหนด", start: "2026-07-10", end: "2026-07-10", type: "DEADLINE" },
    { title: "Push ครบกำหนด", start: "2026-07-11", end: "2026-07-11", type: "DEADLINE" },
    { title: "Rate limit ครบกำหนด", start: "2026-07-14", end: "2026-07-14", type: "DEADLINE" },
    { title: "กราฟ v2 ครบกำหนด", start: "2026-07-15", end: "2026-07-15", type: "DEADLINE" },
    { title: "แผน QA ครบกำหนด", start: "2026-07-16", end: "2026-07-16", type: "DEADLINE" },
    { title: "ทอม · ลาพักร้อน", start: "2026-07-20", end: "2026-07-24", type: "LEAVE" },
    { title: "Terraform ครบกำหนด", start: "2026-07-21", end: "2026-07-21", type: "DEADLINE" },
    { title: "รีลีส 2.4", start: "2026-07-24", end: "2026-07-24", type: "DEADLINE" },
  ] as const;
  for (const e of calendarSeed) {
    await prisma.calendarEvent.create({
      data: { title: e.title, startDate: d(e.start), endDate: d(e.end), type: e.type },
    });
  }

  /* ------------------------- Leave-type policies ---------------------- */
  const leaveTypeSeed = [
    { name: "ลาพักร้อน", daysLabel: "20 วัน / ปี", color: "#0d9488", autoApprove: false, sortOrder: 0 },
    { name: "ลาป่วย", daysLabel: "10 วัน / ปี", color: "#f59e0b", autoApprove: true, sortOrder: 1 },
    { name: "ลากิจ", daysLabel: "5 วัน / ปี", color: "#8b5cf6", autoApprove: false, sortOrder: 2 },
    { name: "ลาเลี้ยงดูบุตร", daysLabel: "ตามนโยบายบริษัท", color: "#3b82f6", autoApprove: false, sortOrder: 3 },
  ];
  for (const lt of leaveTypeSeed) {
    await prisma.leaveTypePolicy.create({ data: lt });
  }

  /* ----------------------------- Team setting ------------------------- */
  await prisma.teamSetting.create({
    data: { teamName: "ทีมแพลตฟอร์ม", reportReminderTime: "16:30 น." },
  });

  const counts = {
    users: usersSeed.length,
    projects: projectsSeed.length,
    reports: reportsSeed.length,
    tasks: tasksSeed.length,
    leaves: leavesSeed.length,
    activity: activitySeed.length,
    calendarEvents: calendarSeed.length,
    leaveTypes: leaveTypeSeed.length,
  };
  console.log("✅ Seed complete:", counts);
  console.log("   Login with any seeded email + password: password123");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
