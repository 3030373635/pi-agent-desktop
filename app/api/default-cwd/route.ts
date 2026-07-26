import { NextResponse } from "next/server";
import { mkdirSync } from "fs";
import { join } from "path";
import { allowFileRoot } from "@/lib/file-access";
import { userHome } from "@/lib/user-home";

// POST /api/default-cwd
// Creates ~/pi-cwd-<YYYYMMDD> if it doesn't exist and returns the path.
// The base comes from userHome() rather than homedir() directly — see the
// note there for why a literal home directory here breaks the Windows build.
export async function POST() {
  try {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const dir = join(userHome(), `pi-cwd-${date}`);
    mkdirSync(dir, { recursive: true });
    allowFileRoot(dir);
    return NextResponse.json({ cwd: dir });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
