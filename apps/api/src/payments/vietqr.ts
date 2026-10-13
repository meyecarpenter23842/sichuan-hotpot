/**
 * Manual bank-transfer QR. These are PUBLIC payee details, supplied from
 * deployment environment; never a fabricated bank account or proof of payment.
 * The payment record freezes the beneficiary at order creation.
 */
export interface QrBeneficiary {
  bankBin: string;
  accountNo: string;
  accountName: string;
}
export interface QrPaymentRecord {
  method: string;
  qrBankBin: string | null;
  qrAccountNo: string | null;
  qrAccountName: string | null;
}

export function configuredQr(): QrBeneficiary | null {
  const bankBin = process.env.VIETQR_BANK_BIN?.trim() ?? "";
  const accountNo = process.env.VIETQR_ACCOUNT_NO?.trim() ?? "";
  const accountName = process.env.VIETQR_ACCOUNT_NAME?.trim() ?? "";
  if (!/^[0-9]{6}$/.test(bankBin) || !/^[a-zA-Z0-9]{4,19}$/.test(accountNo)
    || !/^[\p{L}\p{N} .'-]{2,80}$/u.test(accountName)) return null;
  return { bankBin, accountNo, accountName };
}

export function qrInstructions(orderId: string, totalVnd: number, payment: QrPaymentRecord) {
  if (payment.method !== "QR" || !payment.qrBankBin
    || !payment.qrAccountNo || !payment.qrAccountName
    || !Number.isSafeInteger(totalVnd) || totalVnd < 1
    || !/^[0-9a-f-]{36}$/i.test(orderId)
    || !/^[0-9]{6}$/.test(payment.qrBankBin)
    || !/^[a-zA-Z0-9]{4,19}$/.test(payment.qrAccountNo)) return null;
  // Up to 35 alphanumeric characters, unique across UUIDv4 orders.
  const transferReference = "LTX" + orderId.replaceAll("-", "").toUpperCase();
  const url = new URL(
    "https://img.vietqr.io/image/" + payment.qrBankBin + "-"
      + payment.qrAccountNo + "-compact2.png",
  );
  url.searchParams.set("amount", String(totalVnd));
  url.searchParams.set("addInfo", transferReference);
  url.searchParams.set("accountName", payment.qrAccountName);
  return {
    bankBin: payment.qrBankBin,
    accountNo: payment.qrAccountNo,
    accountName: payment.qrAccountName,
    transferReference,
    amountVnd: totalVnd,
    imageUrl: url.toString(),
  };
}
