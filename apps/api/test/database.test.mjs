import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { PrismaClient, Prisma } = require("@prisma/client");

test("development migration stores order financial/address/policy snapshots and prevents duplicate checkout", async () => {
  assert.ok(process.env.DATABASE_URL, "Isolated CI PostgreSQL is required");
  const prisma = new PrismaClient();
  try {
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        const mark = randomUUID().slice(0, 8);
        const user = await tx.user.create({ data: { clerkSubject: "test_clerk_" + mark } });
        const branch = await tx.branch.create({
          data: { code: "TEST_" + mark, name: "Test Branch", latitude: "10.1234567", longitude: "106.1234567" },
        });
        const version = await tx.deliveryPolicyVersion.create({
          data: {
            branchId: branch.id, version: 1, acceptingOrders: true,
            baseMeters: 2000, baseFeeVnd: 10000, extraStepMeters: 1000,
            extraStepFeeVnd: 5000, maxRoadMeters: 8000,
            minSubtotalVnd: 80000,
          },
        });
        const category = await tx.catalogCategory.create({
          data: { branchId: branch.id, name: "Lẩu" },
        });
        const product = await tx.product.create({
          data: { categoryId: category.id, name: "Lẩu thử nghiệm", priceVnd: 89000 },
        });
        const key = "checkout-" + mark;
        const order = await tx.order.create({
          data: {
            customerId: user.id, branchId: branch.id, deliveryPolicyVersionId: version.id,
            idempotencyKey: key, subtotalVnd: 89000, deliveryFeeVnd: 10000,
            totalVnd: 99000, roadDistanceMeters: 2000,
            addressLineSnapshot: "Địa chỉ mẫu không phải dữ liệu khách hàng",
            latitudeSnapshot: "10.2345678", longitudeSnapshot: "106.2345678",
            items: {
              create: [{
                productId: product.id, productName: product.name,
                quantity: 1, unitPriceVnd: 89000, lineTotalVnd: 89000,
                modifiers: { create: [{ name: "Độ cay vừa", priceVnd: 0 }] },
              }],
            },
            statusHistory: { create: [{ toStatus: "PENDING" }] },
            payment: { create: { method: "COD", amountVnd: 99000 } },
          },
          include: { items: { include: { modifiers: true } }, deliveryPolicyVersion: true },
        });
        assert.equal(order.totalVnd, 99000);
        assert.equal(order.items[0].productName, "Lẩu thử nghiệm");
        assert.equal(order.items[0].modifiers[0].name, "Độ cay vừa");
        assert.equal(order.deliveryPolicyVersion.version, 1);
        assert.equal(order.addressLineSnapshot, "Địa chỉ mẫu không phải dữ liệu khách hàng");
        await assert.rejects(
          tx.order.create({
            data: {
              customerId: user.id, branchId: branch.id, deliveryPolicyVersionId: version.id,
              idempotencyKey: key, subtotalVnd: 89000, deliveryFeeVnd: 10000,
              totalVnd: 99000, roadDistanceMeters: 2000,
              addressLineSnapshot: "test",
              latitudeSnapshot: "10.2345678", longitudeSnapshot: "106.2345678",
            },
          }),
          (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002",
        );
        throw new Error("EXPECTED_TEST_ROLLBACK");
      }),
      /EXPECTED_TEST_ROLLBACK/,
    );
  } finally {
    await prisma.$disconnect();
  }
});
