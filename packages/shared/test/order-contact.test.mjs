import test from "node:test";
import assert from "node:assert/strict";
import { orderCustomerCallUrl, orderCustomerDirectionsUrl } from "../dist/order-contact.js";

test("only real Vietnamese mobile snapshots become dialable tel links", () => {
  assert.equal(orderCustomerCallUrl("+84901111222"), "tel:+84901111222");
  assert.equal(orderCustomerCallUrl("0901111222"), "tel:0901111222");
  for (const bad of ["", null, "tel:+84901111222", "+84901111222;123",
    "+84901111222?body=xyz", "javascript:alert(1)", "0000000000"]) {
    assert.equal(orderCustomerCallUrl(bad), null);
  }
});

test("directions use verified immutable customer GPS, not address text or unsupported schemes", () => {
  assert.equal(orderCustomerDirectionsUrl("10.7731", "106.7032"),
    "https://www.google.com/maps/dir/?api=1&destination=10.7731%2C106.7032&travelmode=driving");
  assert.equal(orderCustomerDirectionsUrl(" 10.7731 ", " 106.7032 "),
    orderCustomerDirectionsUrl("10.7731", "106.7032"));
  for (const [lat, lon] of [[null, null], ["0", "0"], ["91", "106"],
    ["10", "181"], ["NaN", "106"], ["10&mode=x", "106"],
    ["10.1", "https://evil.example"], ["", "106.1"]]) {
    assert.equal(orderCustomerDirectionsUrl(lat, lon), null);
  }
});
