import { describe, expect, it, vi } from "vitest";
import { Linking } from "react-native";

import { buildPaymentUrl } from "./payment-link";
import { createNativeActions } from "./native-actions";

vi.mock("react-native", () => ({
  Linking: {
    openURL: vi.fn(async () => undefined),
  },
}));

describe("native payment handoff", () => {
  it("uses the Payments app scheme, route, and expected query names", () => {
    const url = buildPaymentUrl({
      baseUrl: "egitpayments://take-payment",
      customerName: "A & B Pty Ltd",
      requestNumber: "REQ-100284",
    });

    expect(url).toBe(
      "egitpayments://take-payment?jobNumber=REQ-100284&customerName=A+%26+B+Pty+Ltd",
    );
    expect(url?.startsWith("egitpayments://take-payment?")).toBe(true);
    expect(new URLSearchParams(url?.split("?")[1]).get("jobNumber")).toBe(
      "REQ-100284",
    );
    expect(new URLSearchParams(url?.split("?")[1]).get("customerName")).toBe(
      "A & B Pty Ltd",
    );
  });

  it("round-trips spaces, ampersands, slashes, and punctuation", () => {
    const url = buildPaymentUrl({
      baseUrl: "egitpayments://take-payment",
      customerName: "East Gippsland Health & Tech / Bairnsdale #1",
      requestNumber: "REQ/100 284",
    });
    const params = new URLSearchParams(url?.split("?")[1]);

    expect(params.get("jobNumber")).toBe("REQ/100 284");
    expect(params.get("customerName")).toBe(
      "East Gippsland Health & Tech / Bairnsdale #1",
    );
  });

  it("supports an overridden Payments app base URL", () => {
    expect(
      buildPaymentUrl({
        baseUrl: "egitpayments://take-payment?source=command-centre",
        customerName: "OneHarvest",
        requestNumber: "REQ-100301",
      }),
    ).toBe(
      "egitpayments://take-payment?source=command-centre&jobNumber=REQ-100301&customerName=OneHarvest",
    );
  });

  it("does not build malformed payment links when required data is missing", () => {
    expect(
      buildPaymentUrl({
        baseUrl: "egitpayments://take-payment",
        customerName: "OneHarvest",
        requestNumber: null,
      }),
    ).toBeNull();
    expect(
      buildPaymentUrl({
        baseUrl: "egitpayments://take-payment",
        customerName: null,
        requestNumber: "REQ-100301",
      }),
    ).toBeNull();
  });

  it("opens the Payments app without pre-submitting a payment", async () => {
    const actions = createNativeActions();

    await expect(
      actions.takePayment({
        customerName: "OneHarvest",
        requestNumber: "REQ-100301",
      }),
    ).resolves.toBe(true);

    expect(Linking.openURL).toHaveBeenCalledWith(
      "egitpayments://take-payment?jobNumber=REQ-100301&customerName=OneHarvest",
    );
  });

  it("does not open the Payments app when required data is missing", async () => {
    vi.mocked(Linking.openURL).mockClear();
    const actions = createNativeActions();

    await expect(
      actions.takePayment({
        customerName: null,
        requestNumber: "REQ-100301",
      }),
    ).resolves.toBe(false);

    expect(Linking.openURL).not.toHaveBeenCalled();
  });
});
