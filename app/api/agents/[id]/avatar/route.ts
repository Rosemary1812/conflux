import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { agents } from "@/lib/db/schema";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const ALLOWED_EXTENSIONS: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml"
};

const MAX_FILE_SIZE = 1024 * 1024;

function isUnderAllowedRoot(absolute: string): boolean {
  const allowedRoots = [path.resolve(process.cwd()), path.resolve(os.homedir())];
  return allowedRoots.some((root) => {
    const rel = path.relative(root, absolute);
    return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
  });
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const row = getDb().select().from(agents).where(eq(agents.id, id)).get();

    if (!row) {
      return NextResponse.json({ error: "Agent 不存在" }, { status: 404 });
    }
    if (row.isSystem) {
      return NextResponse.json({ error: "内置 Agent 无上传头像" }, { status: 403 });
    }
    if (row.avatarKind !== "uploaded") {
      return NextResponse.json({ error: "Agent 头像非上传类型" }, { status: 400 });
    }

    const rawPath = row.avatarValue ?? "";
    if (!/^([a-zA-Z]:\\|\/)[^\x00]+$/.test(rawPath)) {
      return NextResponse.json({ error: "avatar 路径不是绝对路径" }, { status: 400 });
    }

    const absolute = path.resolve(rawPath);
    if (!isUnderAllowedRoot(absolute)) {
      return NextResponse.json({ error: "avatar 路径不在允许范围内" }, { status: 400 });
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(absolute);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return NextResponse.json({ error: "avatar 文件不存在" }, { status: 404 });
      }
      throw err;
    }
    if (!stat.isFile()) {
      return NextResponse.json({ error: "avatar 路径不是文件" }, { status: 400 });
    }
    if (stat.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "avatar 文件超过 1MB 限制" }, { status: 413 });
    }

    const ext = path.extname(absolute).toLowerCase();
    const contentType = ALLOWED_EXTENSIONS[ext];
    if (!contentType) {
      return NextResponse.json(
        { error: `avatar 扩展名 ${ext || "(无)"} 不在白名单内` },
        { status: 400 }
      );
    }

    const bytes = fs.readFileSync(absolute);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(stat.size),
        "Cache-Control": "private, max-age=3600"
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取 avatar 失败" },
      { status: 500 }
    );
  }
}
