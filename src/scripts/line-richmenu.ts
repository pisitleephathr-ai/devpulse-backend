/**
 * Set up (or replace) the LINE OA rich menu via the Messaging API.
 *
 *   npm run line:richmenu            # generate the image + create + set default
 *   npm run line:richmenu -- path/to/image.png   # use your own 2500x1686 PNG
 *   npm run line:richmenu -- --clear             # remove all rich menus
 *
 * NOTE: the image-upload host (api-data.line.me) is unreachable from some
 * networks. If this fails with a connect timeout, run the server-side trigger
 * instead: POST /api/cron/line-richmenu with the CRON_SECRET (runs inside the
 * deployed environment). See src/lib/line-richmenu.ts.
 */
import { readFile } from "node:fs/promises";
import { clearRichMenus, publishRichMenu } from "../lib/line-richmenu";

async function main() {
  const arg = process.argv[2];

  if (arg === "--clear") {
    const deleted = await clearRichMenus();
    console.log(`✅ removed ${deleted.length} rich menu(s)`);
    return;
  }

  const image = arg ? await readFile(arg) : undefined;
  console.log(image ? "Publishing with provided image…" : "Generating image + publishing…");
  const { richMenuId, buttons } = await publishRichMenu(image);
  console.log(`✅ rich menu live: ${richMenuId}`);
  console.log(`   buttons → ${buttons.join(", ")}`);
}

main().catch((err) => {
  console.error("❌", err instanceof Error ? err.message : err);
  process.exit(1);
});
