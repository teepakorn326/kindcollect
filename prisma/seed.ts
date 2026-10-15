// `pnpm db:seed` — runs with Node's built-in TypeScript type stripping (Node ≥ 22.18), no extra tooling.
import { PrismaClient } from "@prisma/client";
import { seedDemo } from "../src/lib/demo/seed.ts";

const db = new PrismaClient();

try {
  const counts = await seedDemo(db);
  console.log("Seeded demo data:");
  console.table(counts);
} finally {
  await db.$disconnect();
}
