// Narrow serializer for delivery riders. Never widen this to the full Job
// type: riders must not see file paths, pricing breakdown, or admin fields.
export type DeliveryJobRow = {
  id: string;
  token: string;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  delivery_latitude: number | null;
  delivery_longitude: number | null;
  page_count: number;
  copies: number;
  price_paise: number;
  delivery_fee_paise: number;
  created_at: string;
  delivery_status: "out_for_delivery" | null;
};

export const DELIVERY_JOB_COLUMNS =
  "id, token, customer_name, customer_phone, delivery_address, delivery_latitude, delivery_longitude, page_count, copies, price_paise, delivery_fee_paise, created_at, delivery_status";

export type DeliveryOrderView = {
  id: string;
  token: string;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  deliveryLatitude: number | null;
  deliveryLongitude: number | null;
  pageCount: number;
  copies: number;
  amountPaise: number;
  createdAt: string;
  deliveryStatus: "out_for_delivery" | null;
};

export function toDeliveryOrderView(row: DeliveryJobRow): DeliveryOrderView {
  return {
    id: row.id,
    token: row.token,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    deliveryAddress: row.delivery_address,
    deliveryLatitude: row.delivery_latitude,
    deliveryLongitude: row.delivery_longitude,
    pageCount: row.page_count,
    copies: row.copies,
    amountPaise: row.price_paise + row.delivery_fee_paise,
    createdAt: row.created_at,
    deliveryStatus: row.delivery_status,
  };
}
