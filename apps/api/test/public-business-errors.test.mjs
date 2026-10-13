import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { UnprocessableEntityException } = require("@nestjs/common");
const { ApiExceptionFilter } = require("../dist/http/api-exception.filter.js");
function run(exception) {
  const response = {
    status(n) { this.statusCode = n; return this; },
    json(obj) { this.payload = obj; return this; },
  };
  const host = { switchToHttp: () => ({
    getRequest: () => ({ requestId: "sanitized-ci-id" }),
    getResponse: () => response,
  }) };
  new ApiExceptionFilter().catch(exception, host);
  return response;
}
test("known delivery quote errors remain useful, but no sensitive data are serialized", () => {
  const outside = run(new UnprocessableEntityException({ code: "OUT_OF_RANGE", stack: "secret" }));
  assert.equal(outside.statusCode, 422);
  assert.equal(outside.payload.error.code, "OUT_OF_RANGE");
  assert.equal(JSON.stringify(outside.payload).includes("secret"), false);
  const closed = run(new UnprocessableEntityException({ code: "STORE_CLOSED" }));
  assert.equal(closed.payload.error.code, "STORE_CLOSED");
});
test("forged or unrecognized client-error code is still redacted", () => {
  const unknown = run(new UnprocessableEntityException({ code: "PASSWORD=topsecret" }));
  assert.equal(unknown.payload.error.code, "UNPROCESSABLE_ENTITY");
  assert.equal(JSON.stringify(unknown.payload).includes("topsecret"), false);
});
