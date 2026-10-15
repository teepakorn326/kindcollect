import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { seedDemo } from "@/lib/demo/seed";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// "Reset demo data": truncate and re-seed the scenario. Basic Auth protects it like every other route.
export async function POST() {
  const counts = await seedDemo(db);
  revalidatePath("/", "layout");
  return NextResponse.json({ ok: true, counts });
}
