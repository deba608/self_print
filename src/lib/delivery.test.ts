import { describe, expect, it } from "vitest";
import { toDeliveryOrderView, type DeliveryJobRow } from "./delivery";

const row: DeliveryJobRow = {
  id: "j1",
  token: "TOK123",
  customer_name: "Asha",
  customer_phone: "9999999999",
  delivery_address: "12 Main St",
  delivery_latitude: 12.9,
  delivery_longitude: 77.6,
  delivery_accuracy_meters: 14.5,
  delivery_location_captured_at: "2026-08-01T09:59:00Z",
  page_count: 4,
  copies: 2,
  price_paise: 4000,
  delivery_fee_paise: 2000,
  created_at: "2026-08-01T10:00:00Z",
  delivery_status: null,
};

describe("toDeliveryOrderView", () => {
  it("maps snake_case row to narrow camelCase view with summed amount", () => {
    expect(toDeliveryOrderView(row)).toEqual({
      id: "j1",
      token: "TOK123",
      customerName: "Asha",
      customerPhone: "9999999999",
      deliveryAddress: "12 Main St",
      deliveryLatitude: 12.9,
      deliveryLongitude: 77.6,
      deliveryAccuracyMeters: 14.5,
      deliveryLocationCapturedAt: "2026-08-01T09:59:00Z",
      pageCount: 4,
      copies: 2,
      amountPaise: 6000,
      createdAt: "2026-08-01T10:00:00Z",
      deliveryStatus: null,
    });
  });

  it("never exposes extra columns", () => {
    const view = toDeliveryOrderView({ ...row, storage_path: "secret.pdf" } as never);
    expect(Object.keys(view)).not.toContain("storage_path");
    expect(Object.keys(view)).toHaveLength(14);
  });
});
