import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const critical = [
  "package.json", "package-lock.json", "tsconfig.base.json",
  "apps/api/package.json", "apps/customer/package.json", "apps/admin/package.json",
  "packages/ui/package.json", "packages/shared/package.json",
  "packages/shared/src/delivery.ts", "packages/shared/src/orders.ts",
  "packages/shared/src/index.ts",
];
for (const name of critical) {
  if (!fs.statSync(path.join(root, name)).isFile()) throw Error("Missing: " + name);
}
for (const name of ["vercel.json", "apps/customer/vercel.json", "apps/admin/vercel.json"]) {
  const json = JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
  if (json.git?.deploymentEnabled !== false) throw Error("Auto-deploy lock missing: " + name);
}
for (const name of critical.filter((n) => n.endsWith(".ts"))) {
  const content = fs.readFileSync(path.join(root, name), "utf8");
  if (/\r/.test(content) || /[^\S\r\n]+$/m.test(content)) throw Error("Whitespace: " + name);
}
console.log("P0 structure, source hygiene and no-auto-deploy gate: PASS");
