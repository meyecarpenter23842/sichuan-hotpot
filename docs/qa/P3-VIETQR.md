# P3: manual QR transfer checkout

The owner must supply three bank payee environment values:
\`VIETQR_BANK_BIN\` (6 digits), \`VIETQR_ACCOUNT_NO\` (4-19 alphanumeric),
\`VIETQR_ACCOUNT_NAME\` (bank-confirmed beneficiary name).
Do not invent, commit or publish a bank account. No need to share these
values in this repository. The service checks these values at startup or
when requested; incomplete configuration means QR cannot be selected.

GET /customer/orders/payment-methods returns {codAvailable:true,qrAvailable:boolean}.
QR orders are refused (422) when QR isn't configured. A COD order is
still allowed. On QR order creation the verified beneficiary is snapshotted
on Payment, just like the order's server-calculated amount. Retrying an
idempotency key uses the saved payee details even if current config changes.
GET /customer/orders/:id returns only that customer's payment instructions.
The image URL is the VietQR Quick Link for the account, amount and unique
35-character order transfer reference. A third-party VietQR image fetch
sees the payee account, amount and order reference; it does not include
customer phone/address. Manual bank account details remain visible as
fallback if the image service is unavailable.

QR STATUS REMAINS PENDING until an authenticated, authorized later admin
reconciliation changes it. A screenshot or external image never confirms
bank receipt. No QR proof is accepted from the customer as payment evidence.

CI covers no-config and configured flows, replay snapshots, generated link
format, ownership, routing failure and database migration on isolated PG.
Real bank app scan, Android/iPhone and production deployment are NOT TESTED.
