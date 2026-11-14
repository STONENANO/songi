/**
 * Event ids shared by the browser Pixel and the server's Conversions API. Meta drops the
 * second copy of an event with the same name and id, so both sides must build them here.
 */
export const metaEventId = {
  lead: (requestId: string) => `lead:${requestId}`,
  checkout: (orderId: string) => `checkout:${orderId}`,
  purchase: (orderId: string) => `purchase:${orderId}`,
};
