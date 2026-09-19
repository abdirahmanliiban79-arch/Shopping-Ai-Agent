import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "shopping-ai-agent",
  eventKey: process.env.INNGEST_EVENT_KEY,
});

export const PRODUCT_SEARCH_EVENT = "app/product.search" as const;

export interface ProductSearchEventData {
  query: string;
  searchId: string;
}

export type ProductSearchEvent = {
  name: typeof PRODUCT_SEARCH_EVENT;
  data: ProductSearchEventData;
};