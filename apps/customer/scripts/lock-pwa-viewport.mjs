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
const guard = '<style>html,body,#root{width:100%;max-width:100%;overflow-x:hidden;touch-action:manipulation;-webkit-text-size-adjust:100%}</style><script>document.addEventListener("gesturestart",function(e){e.preventDefault()},{passive:false});document.addEventListener("gesturechange",function(e){e.preventDefault()},{passive:false});</script>';
html = html.replace(/<\/head>/i, guard + "</head>");
if (!html.includes("user-scalable=no") || !html.includes("gesturestart")) throw new Error("PWA zoom guard missing");
writeFileSync(file, html);
console.log("PWA responsive fixed viewport: PASS");
