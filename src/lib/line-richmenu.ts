/**
 * LINE OA rich menu setup — build a 2x3 grid of buttons that deep-link into the
 * web app, publish it, and set it as the default for all users. Callable from a
 * CLI script (src/scripts/line-richmenu.ts) or a server-side trigger (the cron
 * controller) — the latter matters because the image-upload host
 * (api-data.line.me) may be unreachable from some networks, so running inside
 * the deployed environment is the reliable path.
 */
import { v2 as cloudinary } from "cloudinary";
import { env } from "./env";
import { appBaseUrl } from "./line";

const API = "https://api.line.me/v2/bot";
const API_DATA = "https://api-data.line.me/v2/bot";

export const RICHMENU_WIDTH = 2500;
export const RICHMENU_HEIGHT = 1686;
const COLS = 3;
const ROWS = 2;
const CELL_W = RICHMENU_WIDTH / COLS;
const CELL_H = RICHMENU_HEIGHT / ROWS;

type Cell = { label: string; emoji: string; path: string };

/** The 6 buttons, left→right, top→bottom. Paths are appended to the app base. */
export const CELLS: Cell[] = [
  { label: "บอร์ดงาน", emoji: "🗂", path: "/tasks" },
  { label: "รายงานประจำวัน", emoji: "📝", path: "/reports" },
  { label: "ปฏิทินทีม", emoji: "📅", path: "/calendar" },
  { label: "คำขอลา", emoji: "🌴", path: "/leaves" },
  { label: "แดชบอร์ด", emoji: "📊", path: "/dashboard" },
  { label: "โปรไฟล์", emoji: "👤", path: "/profile" },
];

function token(): string {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) {
    throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not set");
  }
  return env.LINE_CHANNEL_ACCESS_TOKEN;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${token()}` };
}

async function lineJson<T>(
  url: string,
  init: RequestInit & { body?: string } = {}
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${url} → ${res.status} ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/** Delete every existing rich menu so a publish fully replaces the old one. */
export async function clearRichMenus(): Promise<string[]> {
  const { richmenus } = await lineJson<{ richmenus: { richMenuId: string }[] }>(
    `${API}/richmenu/list`
  );
  const deleted: string[] = [];
  for (const m of richmenus ?? []) {
    await lineJson(`${API}/richmenu/${m.richMenuId}`, { method: "DELETE" });
    deleted.push(m.richMenuId);
  }
  return deleted;
}

/** Build the rich menu object (grid areas → URI actions into the web app). */
function buildMenu(base: string) {
  const areas = CELLS.map((cell, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    return {
      bounds: {
        x: Math.round(col * CELL_W),
        y: Math.round(row * CELL_H),
        width: Math.round(CELL_W),
        height: Math.round(CELL_H),
      },
      action: { type: "uri", label: cell.label, uri: `${base}${cell.path}` },
    };
  });
  return {
    size: { width: RICHMENU_WIDTH, height: RICHMENU_HEIGHT },
    selected: true,
    name: "DevPulse main menu",
    chatBarText: "เมนู DevPulse",
    areas,
  };
}

function esc(s: string): string {
  return s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));
}

/** A themed SVG matching the grid, rasterized to PNG by Cloudinary. */
function buildSvg(): string {
  const teal = "#0d9488";
  const cells = CELLS.map((cell, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const cx = col * CELL_W + CELL_W / 2;
    const cy = row * CELL_H + CELL_H / 2;
    return `
      <g>
        <text x="${cx}" y="${cy - 40}" font-size="150" text-anchor="middle" dominant-baseline="middle">${cell.emoji}</text>
        <text x="${cx}" y="${cy + 110}" font-size="72" font-family="sans-serif" font-weight="700" fill="#1f2937" text-anchor="middle">${esc(cell.label)}</text>
      </g>`;
  }).join("");
  const grid = `
    <line x1="${CELL_W}" y1="0" x2="${CELL_W}" y2="${RICHMENU_HEIGHT}" stroke="#e5e7eb" stroke-width="3"/>
    <line x1="${CELL_W * 2}" y1="0" x2="${CELL_W * 2}" y2="${RICHMENU_HEIGHT}" stroke="#e5e7eb" stroke-width="3"/>
    <line x1="0" y1="${CELL_H}" x2="${RICHMENU_WIDTH}" y2="${CELL_H}" stroke="#e5e7eb" stroke-width="3"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${RICHMENU_WIDTH}" height="${RICHMENU_HEIGHT}" viewBox="0 0 ${RICHMENU_WIDTH} ${RICHMENU_HEIGHT}">
    <rect width="${RICHMENU_WIDTH}" height="${RICHMENU_HEIGHT}" fill="#ffffff"/>
    <rect width="${RICHMENU_WIDTH}" height="12" fill="${teal}"/>
    ${grid}
    ${cells}
  </svg>`;
}

/** Rasterize the generated SVG to a PNG buffer via Cloudinary. */
export async function generateRichMenuImage(): Promise<Buffer> {
  if (
    !env.CLOUDINARY_CLOUD_NAME ||
    !env.CLOUDINARY_API_KEY ||
    !env.CLOUDINARY_API_SECRET
  ) {
    throw new Error("Cannot auto-generate the image: CLOUDINARY_* not set");
  }
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  const svg = buildSvg();
  const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const uploaded = await cloudinary.uploader.upload(dataUri, {
    resource_type: "image",
    folder: `${env.CLOUDINARY_UPLOAD_FOLDER || "devpulse"}/system`,
    public_id: "line-richmenu",
    overwrite: true,
  });
  const pngUrl = cloudinary.url(uploaded.public_id, {
    resource_type: "image",
    format: "png",
    width: RICHMENU_WIDTH,
    height: RICHMENU_HEIGHT,
    crop: "fill",
    secure: true,
    version: uploaded.version,
  });
  const res = await fetch(pngUrl);
  if (!res.ok) throw new Error(`rasterize failed: ${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Publish the rich menu: clear existing → create → upload image → set default.
 * Auto-generates the image when none is supplied. Returns the new menu id.
 */
export async function publishRichMenu(
  image?: Buffer
): Promise<{ richMenuId: string; buttons: string[] }> {
  const base = appBaseUrl();
  if (!base) throw new Error("APP_URL (or a single CORS_ORIGIN) must be an http(s) URL");

  const png = image ?? (await generateRichMenuImage());
  if (png.byteLength > 1_000_000) {
    throw new Error(`image is ${png.byteLength} bytes (LINE limit is 1MB)`);
  }

  await clearRichMenus();

  const { richMenuId } = await lineJson<{ richMenuId: string }>(`${API}/richmenu`, {
    method: "POST",
    body: JSON.stringify(buildMenu(base)),
  });

  const up = await fetch(`${API_DATA}/richmenu/${richMenuId}/content`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "image/png" },
    body: new Uint8Array(png),
  });
  if (!up.ok) throw new Error(`image upload failed: ${up.status} ${await up.text()}`);

  await lineJson(`${API}/user/all/richmenu/${richMenuId}`, { method: "POST" });

  return { richMenuId, buttons: CELLS.map((c) => c.label) };
}
