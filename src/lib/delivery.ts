// Narrow serializer for delivery riders. Never widen this to the full Job
// type: riders must not see file paths, pricing breakdown, or admin fields.
export type DeliveryJobRow = {
  id: string;
  token: string;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  delivery_pincode: string | null;
  delivery_area: string | null;
  delivery_latitude: number | null;
  delivery_longitude: number | null;
  delivery_accuracy_meters: number | null;
  delivery_location_captured_at: string | null;
  page_count: number;
  copies: number;
  price_paise: number;
  delivery_fee_paise: number;
  created_at: string;
  delivery_status: "packed" | "picked_up" | "out_for_delivery" | null;
  paid_at: string | null;
};

export const DELIVERY_JOB_COLUMNS =
  "id, token, customer_name, customer_phone, delivery_address, delivery_pincode, delivery_area, delivery_latitude, delivery_longitude, delivery_accuracy_meters, delivery_location_captured_at, page_count, copies, price_paise, delivery_fee_paise, created_at, delivery_status, paid_at";

export type DeliveryOrderView = {
  id: string;
  token: string;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  deliveryPincode: string | null;
  deliveryArea: string | null;
  deliveryLatitude: number | null;
  deliveryLongitude: number | null;
  deliveryAccuracyMeters: number | null;
  deliveryLocationCapturedAt: string | null;
  pageCount: number;
  copies: number;
  amountPaise: number;
  paidAt: string | null;
  createdAt: string;
  deliveryStatus: "packed" | "picked_up" | "out_for_delivery" | null;
};

export function toDeliveryOrderView(row: DeliveryJobRow): DeliveryOrderView {
  return {
    id: row.id,
    token: row.token,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    deliveryAddress: row.delivery_address,
    deliveryPincode: row.delivery_pincode,
    deliveryArea: row.delivery_area,
    deliveryLatitude: row.delivery_latitude,
    deliveryLongitude: row.delivery_longitude,
    deliveryAccuracyMeters: row.delivery_accuracy_meters,
    deliveryLocationCapturedAt: row.delivery_location_captured_at,
    pageCount: row.page_count,
    copies: row.copies,
    amountPaise: row.price_paise + row.delivery_fee_paise,
    paidAt: row.paid_at,
    createdAt: row.created_at,
    deliveryStatus: row.delivery_status,
  };
}
