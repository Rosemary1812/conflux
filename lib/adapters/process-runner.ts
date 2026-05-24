import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export type ProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export type RunProcessOptions = {
  cwd?: string;
  env?: Record<string, string>;
  input?: string;
  shell?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
};

export function runProcess(command: string, args: string[], options: RunProcessOptions = {}) {
  return new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      detached: process.platform !== "win32",
      shell: options.shell,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let abortListener: (() => void) | undefined;
    let pendingFailure: Error | undefined;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
      }

      if (abortListener) {
        options.signal?.removeEventListener("abort", abortListener);
      }
    };

    const finish = (result: ProcessResult) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(result);
    };

    const fail = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    };

    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        pendingFailure = new Error(`Process timed out after ${options.timeoutMs}ms: ${command}`);
        killProcessTree(child);
      }, options.timeoutMs);
    }

    abortListener = () => {
      pendingFailure = new DOMException("Process aborted.", "AbortError");
      killProcessTree(child);
    };

    if (options.signal?.aborted) {
      abortListener();
    } else {
      options.signal?.addEventListener("abort", abortListener, { once: true });
    }

    child.stdout.on("data", (data: Buffer) => {
      const chunk = data.toString("utf8");
      stdout += chunk;
      options.onStdout?.(chunk);
    });

    child.stderr.on("data", (data: Buffer) => {
      const chunk = data.toString("utf8");
      stderr += chunk;
      options.onStderr?.(chunk);
    });

    child.on("error", (error) => fail(pendingFailure ?? error));
    child.on("close", (exitCode) => {
      if (pendingFailure) {
        fail(pendingFailure);
        return;
      }

      finish({ exitCode, stdout, stderr });
    });

    if (options.input) {
      child.stdin.write(options.input);
    }

    child.stdin.end();
  });
}

function killProcessTree(child: ChildProcessWithoutNullStreams) {
  if (!child.pid) {
    child.kill();
    return;
  }

  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true
    });

    killer.on("error", () => child.kill());
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

export async function commandExists(command: string) {
  const probe = process.platform === "win32" ? "where.exe" : "sh";
  const args = process.platform === "win32" ? [command] : ["-lc", "command -v \"$1\"", "sh", command];

  try {
    const result = await runProcess(probe, args, { timeoutMs: 5000 });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
