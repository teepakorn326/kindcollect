// Seeded PO / delivery-note documents: typed access to their JSON lines (integer cents).
import type { Prisma } from "@prisma/client";

export type DocLine = { description: string; quantity: number; unitPriceCents: number };

export function docLines(json: Prisma.JsonValue): DocLine[] {
  if (!Array.isArray(json)) return [];
  return json.map((l) => {
    const o = (l ?? {}) as Record<string, unknown>;
    return { description: String(o.description ?? ""), quantity: Number(o.quantity ?? 0), unitPriceCents: Number(o.unitPriceCents ?? 0) };
  });
}
