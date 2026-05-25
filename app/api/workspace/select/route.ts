import { NextResponse } from "next/server";
import { runProcess } from "@/lib/adapters/process-runner";

export const runtime = "nodejs";

export async function POST() {
  if (process.platform !== "win32") {
    return NextResponse.json({ error: "当前只实现了 Windows 本机目录选择器。" }, { status: 501 });
  }

  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.Description = '选择 AgentHub 当前工作区'",
    "$dialog.ShowNewFolderButton = $true",
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
    "  Write-Output $dialog.SelectedPath",
    "}"
  ].join("; ");

  const result = await runProcess("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
    timeoutMs: 5 * 60 * 1000
  });
  const selectedPath = result.stdout.trim();

  if (!selectedPath) {
    return NextResponse.json({ cancelled: true });
  }

  return NextResponse.json({ workspacePath: selectedPath });
}
