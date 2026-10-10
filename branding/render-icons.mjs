// Xuất logo SVG ra các ảnh PNG cho web (PWA) và cho @capacitor/assets (icon + splash Android).
// Cần Playwright + Chromium:  node branding/render-icons.mjs   rồi   npx capacitor-assets generate --android
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); }
catch { ({ chromium } = await import(process.env.PLAYWRIGHT_PATH || "playwright")); }

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const inner = (f) => readFileSync(join(here, f), "utf8").match(/<svg[^>]*>([\s\S]*)<\/svg>/)[1];
const fg = inner("logo-foreground.svg");
const bg = inner("logo-background.svg");
const svg = (body, w = 1024, h = 1024, vb = "0 0 1024 1024") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${vb}">${body}</svg>`;
const scaled = (s) => `<g transform="translate(512 512) scale(${s}) translate(-512 -512)">${fg}</g>`;

const splash = (dark) => `
<div style="width:2732px;height:2732px;display:flex;flex-direction:column;align-items:center;justify-content:center;
  background:${dark ? "#121212" : "radial-gradient(circle at 30% 20%, #E0453A, #B3261E 55%, #7A1410)"};font-family:'DejaVu Serif',Georgia,serif">
  ${svg(scaled(1.25), 900, 900)}
  <div style="margin-top:10px;color:#fff;font-size:150px;font-weight:700;letter-spacing:-3px">HNews</div>
  <div style="margin-top:18px;color:${dark ? "#9a9a9a" : "rgba(255,255,255,.8)"};font:500 64px Inter,sans-serif;letter-spacing:6px">ĐIỂM TIN MỖI NGÀY</div>
</div>`;

const jobs = [
  // @capacitor/assets (Android)
  ["assets/icon-only.png", 1024, svg(bg + scaled(1.3))],
  ["assets/icon-foreground.png", 1024, svg(scaled(1.3))],
  ["assets/icon-background.png", 1024, svg(bg)],
  ["assets/splash.png", 2732, splash(false)],
  ["assets/splash-dark.png", 2732, splash(true)],
  // Web / PWA
  ["docs/icon-192.png", 192, readFileSync(join(here, "logo.svg"), "utf8")],
  ["docs/icon-512.png", 512, readFileSync(join(here, "logo.svg"), "utf8")],
  ["docs/icon-maskable-512.png", 512, svg(bg + scaled(1.15))],
  ["branding/logo-1024.png", 1024, readFileSync(join(here, "logo.svg"), "utf8")],
];

const browser = await chromium.launch();
for (const [out, size, content] of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const html = content.startsWith("<svg")
    ? `<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${content}`
    : `<style>html,body{margin:0}</style>${content}`;
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  mkdirSync(dirname(join(root, out)), { recursive: true });
  await page.screenshot({ path: join(root, out), omitBackground: true });
  await page.close();
  console.log("✓", out);
}
await browser.close();
