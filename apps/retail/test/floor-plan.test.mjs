import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const floor = readFileSync(new URL("../src/RetailFloorPlan.tsx", import.meta.url), "utf8");
const server = readFileSync(new URL("../../api/src/dining/dining.service.ts", import.meta.url), "utf8");

test("floor plan is separate responsive view while existing list, menu, invoice & QR remain", async () => {
  const { default: ts } = await import("typescript");
  for (const [name, input] of [["App.tsx", app], ["RetailFloorPlan.tsx", floor]]) {
    const file = ts.createSourceFile(name, input, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    assert.deepEqual(file.parseDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), []);
  }
  assert.match(app, /retail-desk-floor/);
  assert.match(app, /tableMode === "floor" \? floorPlan/);
  assert.match(app, /retail-desk-order/);
  assert.match(app, /retail-desk-menu/);
  assert.match(app, /retail-qr-queue/);
  assert.match(app, /<RetailSettlementPanel/);
});

test("slots use persisted UUID coordinates, never table index; supports unplaced and scroll", () => {
  assert.match(floor, /export const FLOOR_COLUMNS = 6/);
  assert.match(floor, /Math\.min\(FLOOR_MAX_ROWS, Math\.max\(4, extraRows,/);
  assert.match(floor, /visible\.filter\(hasFloorPosition\)\.map\(t => \(t\.floorRow/);
  assert.match(floor, /t\.floorRow/);
  assert.match(floor, /t\.floorColumn/);
  assert.match(floor, /key=\{table\.id\}/);
  assert.match(floor, /Bàn chưa xếp vị trí/);
  assert.match(floor, /<ScrollView horizontal/);
  assert.match(floor, /floor-slot-/);
  assert.match(floor, /accessibilityRole="button"/);
  assert.match(floor, /Trống/);
  assert.match(floor, /Chờ duyệt QR/);
  assert.match(floor, /Đang phục vụ/);
  assert.match(floor, /Chờ dọn/);
});

test("editing is only for owner/manager, offline disabled; writes are CAS-scoped to branch & area", () => {
  assert.match(floor, /role === "OWNER" \|\| role === "MANAGER"/);
  assert.match(floor, /disabled=\{moving \|\| !online\}/);
  assert.match(floor, /if \(!selected \|\| !editing \|\| moving \|\| !online \|\| !editable\) return/);
  assert.match(app, /expectedRow: table\.floorRow, expectedColumn: table\.floorColumn/);
  assert.match(app, /await refresh\(true\)/);
  assert.match(server, /DINING_FLOOR_STALE/);
  assert.match(server, /DINING_FLOOR_OCCUPIED/);
  assert.match(server, /this\.staff\(auth, branchId, \["OWNER", "MANAGER"\]\)/);
});
