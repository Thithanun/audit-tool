import { NextResponse } from "next/server";

// Simple health check endpoint used by Docker Compose healthcheck
export function GET() {
  return NextResponse.json({ status: "ok" }, { status: 200 });
}
