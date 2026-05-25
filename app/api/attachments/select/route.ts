import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { runProcess } from "@/lib/adapters/process-runner";
import type { AttachmentReference } from "@/lib/conversations/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (process.platform !== "win32") {
      return NextResponse.json({ error: "当前只实现了 Windows 本机文件选择器。" }, { status: 501 });
    }

    const body = (await request.json().catch(() => ({}))) as { imageOnly?: boolean };
    const filter = body.imageOnly
      ? "图片文件 (*.png;*.jpg;*.jpeg;*.webp;*.gif;*.svg)|*.png;*.jpg;*.jpeg;*.webp;*.gif;*.svg"
      : "所有文件 (*.*)|*.*";
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dialog = New-Object System.Windows.Forms.OpenFileDialog",
      "$dialog.Title = '选择 AgentHub 附件文件'",
      "$dialog.Multiselect = $true",
      `$dialog.Filter = '${filter}'`,
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
      "  foreach ($file in $dialog.FileNames) { Write-Output $file }",
      "}"
    ].join("; ");

    const result = await runProcess("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
      timeoutMs: 5 * 60 * 1000
    });
    const filePaths = result.stdout
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);

    if (filePaths.length === 0) {
      return NextResponse.json({ cancelled: true });
    }

    return NextResponse.json({
      attachments: filePaths.map(toAttachmentReference)
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "选择附件失败。" },
      { status: 500 }
    );
  }
}

function toAttachmentReference(filePath: string): AttachmentReference {
  const normalized = path.resolve(filePath);
  const stat = fs.statSync(normalized);

  if (!stat.isFile()) {
    throw new Error("只能选择文件作为附件。");
  }

  fs.accessSync(normalized, fs.constants.R_OK);

  return {
    fileName: path.basename(normalized),
    mimeType: mimeTypeForPath(normalized),
    size: stat.size,
    path: normalized
  };
}

function mimeTypeForPath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".md": "text/markdown",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain",
    ".webp": "image/webp"
  };

  return mimeTypes[extension] ?? "application/octet-stream";
}
