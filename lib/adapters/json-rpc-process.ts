import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
};

type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
};

export class JsonRpcProcessClient {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private stdoutBuffer = "";
  private pending = new Map<number | string, PendingRequest>();
  private listeners = new Set<(message: JsonRpcMessage) => void>();
  private closePromise: Promise<void>;

  constructor(
    command: string,
    args: string[],
    options: {
      cwd?: string;
      env?: Record<string, string | undefined>;
      signal?: AbortSignal;
      shell?: boolean;
    } = {}
  ) {
    this.child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      shell: options.shell,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });

    this.child.stdout.on("data", (data: Buffer) => this.readStdout(data.toString("utf8")));
    this.child.stderr.on("data", (data: Buffer) => {
      const text = data.toString("utf8").trim();

      if (text) {
        this.emit({
          jsonrpc: "2.0",
          method: "$/stderr",
          params: { text }
        });
      }
    });

    this.closePromise = new Promise((resolve) => {
      this.child.on("close", () => {
        for (const request of this.pending.values()) {
          request.reject(new Error("JSON-RPC process closed."));
        }
        this.pending.clear();
        resolve();
      });
    });

    this.child.on("error", (error) => {
      for (const request of this.pending.values()) {
        request.reject(error);
      }
      this.pending.clear();
    });

    if (options.signal?.aborted) {
      this.close();
    } else {
      options.signal?.addEventListener("abort", () => this.close(), { once: true });
    }
  }

  onMessage(listener: (message: JsonRpcMessage) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  request(method: string, params?: unknown) {
    const id = this.nextId++;
    const message: JsonRpcRequest = params === undefined
      ? { jsonrpc: "2.0", id, method }
      : { jsonrpc: "2.0", id, method, params };

    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write(message);
    });
  }

  notify(method: string, params?: unknown) {
    this.write(params === undefined ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", method, params });
  }

  respond(id: number | string, result: unknown) {
    this.write({ jsonrpc: "2.0", id, result });
  }

  respondError(id: number | string, message: string, code = -32000) {
    this.write({ jsonrpc: "2.0", id, error: { code, message } });
  }

  close() {
    if (!this.child.killed) {
      this.child.kill();
    }
  }

  waitForClose() {
    return this.closePromise;
  }

  private readStdout(chunk: string) {
    this.stdoutBuffer += chunk;
    const lines = this.stdoutBuffer.split(/\r?\n/);
    this.stdoutBuffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      try {
        this.handleMessage(JSON.parse(line) as JsonRpcMessage);
      } catch {
        this.emit({ jsonrpc: "2.0", method: "$/stdout", params: { text: line } });
      }
    }
  }

  private handleMessage(message: JsonRpcMessage) {
    if ("id" in message && ("result" in message || "error" in message)) {
      const pending = this.pending.get(message.id);

      if (pending) {
        this.pending.delete(message.id);

        if (message.error) {
          pending.reject(new Error(message.error.message ?? "JSON-RPC request failed."));
        } else {
          pending.resolve(message.result);
        }
      }
    }

    this.emit(message);
  }

  private emit(message: JsonRpcMessage) {
    for (const listener of this.listeners) {
      listener(message);
    }
  }

  private write(message: JsonRpcMessage) {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }
}

export function isJsonRpcRequest(message: JsonRpcMessage): message is JsonRpcRequest {
  return "method" in message && "id" in message;
}

export function isJsonRpcNotification(message: JsonRpcMessage): message is JsonRpcNotification {
  return "method" in message && !("id" in message);
}
