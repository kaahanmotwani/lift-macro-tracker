import { NextResponse } from "next/server";
import { exportEverything } from "@/app/actions/settings";

/** Downloads the signed-in user's complete log as a JSON file. */
export async function GET() {
  const result = await exportEverything();
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(result.data, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="lift-macro-tracker-${stamp}.json"`,
    },
  });
}
