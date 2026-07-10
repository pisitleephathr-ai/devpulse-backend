/**
 * Seed MITSOFT company/public holidays for 2026 (พ.ศ. 2569).
 * Idempotent: keyed by date (UTC midnight of the Bangkok day) — re-running
 * updates in place instead of creating duplicates. Additive; never deletes.
 *
 * Run against the target DB:
 *   DATABASE_URL="<url>" npm run seed:holidays
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type H = { date: string; name: string; description?: string };

// Thai national public holidays observed by the company in 2026.
const HOLIDAYS: H[] = [
  { date: "2026-01-01", name: "วันขึ้นปีใหม่" },
  { date: "2026-03-03", name: "วันมาฆบูชา" },
  { date: "2026-04-13", name: "วันสงกรานต์" },
  { date: "2026-04-14", name: "วันสงกรานต์" },
  { date: "2026-04-15", name: "วันสงกรานต์" },
  { date: "2026-05-01", name: "วันแรงงานแห่งชาติ" },
  { date: "2026-05-04", name: "วันฉัตรมงคล" },
  { date: "2026-06-01", name: "ชดเชยวันวิสาขบูชา", description: "ชดเชยวันอาทิตย์ที่ 31 พฤษภาคม 2569" },
  {
    date: "2026-06-03",
    name: "วันเฉลิมพระชนมพรรษาสมเด็จพระนางเจ้าสุทิดา พัชรสุธาพิมลลักษณ พระบรมราชินี",
  },
  { date: "2026-07-28", name: "วันเฉลิมพระชนมพรรษาพระบาทสมเด็จพระเจ้าอยู่หัว" },
  { date: "2026-07-29", name: "วันอาสาฬหบูชา" },
  {
    date: "2026-08-12",
    name: "วันเฉลิมพระชนมพรรษาสมเด็จพระนางเจ้าสิริกิติ์ พระบรมราชินีนาถ พระบรมราชชนนีพันปีหลวง และวันแม่แห่งชาติ",
  },
  {
    date: "2026-10-13",
    name: "วันคล้ายวันสวรรคต พระบาทสมเด็จพระบรมชนกาธิเบศร มหาภูมิพลอดุลยเดชมหาราช บรมนาถบพิตร",
  },
  { date: "2026-10-23", name: "วันปิยมหาราช" },
  {
    date: "2026-12-07",
    name: "ชดเชยวันคล้ายวันพระบรมราชสมภพ ในหลวงรัชกาลที่ 9 และวันพ่อแห่งชาติ",
    description: "ชดเชยวันเสาร์ที่ 5 ธันวาคม 2569",
  },
  { date: "2026-12-31", name: "วันสิ้นปี" },
];

async function main() {
  let created = 0;
  let updated = 0;
  for (const h of HOLIDAYS) {
    const date = new Date(`${h.date}T00:00:00.000Z`);
    const existing = await prisma.companyHoliday.findFirst({ where: { date } });
    if (existing) {
      await prisma.companyHoliday.update({
        where: { id: existing.id },
        data: { name: h.name, description: h.description ?? "", type: "PUBLIC", isActive: true },
      });
      updated++;
      console.log(`  updated ${h.date}  ${h.name}`);
    } else {
      await prisma.companyHoliday.create({
        data: { date, name: h.name, description: h.description ?? "", type: "PUBLIC", isActive: true },
      });
      created++;
      console.log(`  created ${h.date}  ${h.name}`);
    }
  }
  console.log(`✅ Holidays 2026 seeded — created ${created}, updated ${updated}, total ${HOLIDAYS.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
