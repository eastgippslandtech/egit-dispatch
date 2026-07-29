import { describe, expect, it } from "vitest";

import { buildPaymentUrl } from "./payment-link";

describe("native payment handoff", () => {
  it("prefills the job number and customer name safely", () => {
    expect(
      buildPaymentUrl({
        baseUrl: "egitpayments://take-payment",
        customerName: "A & B Pty Ltd",
        requestNumber: "REQ-100284",
      }),
    ).toBe(
      "egitpayments://take-payment?jobNumber=REQ-100284&customerName=A+%26+B+Pty+Ltd",
    );
  });
});
