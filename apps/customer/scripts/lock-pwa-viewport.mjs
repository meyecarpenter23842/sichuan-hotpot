import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const file = fileURLToPath(new URL("../dist/index.html", import.meta.url));
let html = readFileSync(file, "utf8");
const meta = '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover" />';
if (/<meta\s+name=["']viewport["'][^>]*>/i.test(html)) {
  html = html.replace(/<meta\s+name=["']viewport["'][^>]*>/i, meta);
} else {
  html = html.replace(/<head[^>]*>/i, match => match + meta);
}
// Prevent iOS Safari gesture-zoom and double-tap zoom on the installed PWA.
// This does not suppress system-level screen magnification accessibility.
const guard = '<style>html,body,#root{margin:0;width:100%;max-width:100%;height:100%;overflow:hidden;touch-action:manipulation;-webkit-text-size-adjust:100%}#root{height:100dvh;min-height:0}</style><script>document.addEventListener("gesturestart",function(e){e.preventDefault()},{passive:false});document.addEventListener("gesturechange",function(e){e.preventDefault()},{passive:false});</script>';
html = html.replace(/<\/head>/i, guard + "</head>");
if (!html.includes("user-scalable=no") || !html.includes("gesturestart")) throw new Error("PWA zoom guard missing");
const appIcons = '<link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">';
if (!html.includes('rel="apple-touch-icon"')) html = html.replace(/<\/head>/i, appIcons + "</head>");
writeFileSync(file, html);
console.log("PWA responsive fixed viewport: PASS");
