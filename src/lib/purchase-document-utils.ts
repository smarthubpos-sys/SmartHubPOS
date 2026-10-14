export const statusKey = (purchase: { status: string; paymentStatus: string }) =>
  purchase.status === "cancelled" || purchase.status === "draft" ? purchase.status : purchase.paymentStatus;
