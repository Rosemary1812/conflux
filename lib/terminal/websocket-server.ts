import { createServer, type Server } from "node:http";
import { parse } from "node:url";
import * as pty from "node-pty";
import { WebSocket, WebSocketServer } from "ws";
import { getConversation } from "@/lib/conversations/service";

type TerminalServerState = {
  port: number;
  server: Server;
  wss: WebSocketServer;
};

type GlobalWithTerminal = typeof globalThis & {
  __agentHubTerminalServer?: Promise<TerminalServerState>;
  __agentHubTerminalTokens?: Map<string, TerminalToken>;
};

const terminalGlobal = globalThis as GlobalWithTerminal;
const terminalTokenTtlMs = 30_000;

type TerminalToken = {
  conversationId: string;
  expiresAt: number;
};

export async function ensureTerminalServer() {
  if (!isTerminalEnabled()) {
    throw new Error("Terminal 只在本地开发模式或显式启用后可用。");
  }

  terminalGlobal.__agentHubTerminalServer ??= startTerminalServer();
  const state = await terminalGlobal.__agentHubTerminalServer;

  return {
    url: `ws://127.0.0.1:${state.port}/terminal`
  };
}

export async function createTerminalSession(conversationId: string) {
  const { url } = await ensureTerminalServer();
  const token = crypto.randomUUID();
  terminalGlobal.__agentHubTerminalTokens ??= new Map();
  terminalGlobal.__agentHubTerminalTokens.set(token, {
    conversationId,
    expiresAt: Date.now() + terminalTokenTtlMs
  });

  return {
    url: `${url}?conversationId=${encodeURIComponent(conversationId)}&token=${encodeURIComponent(token)}`
  };
}

async function startTerminalServer(): Promise<TerminalServerState> {
  const server = createServer();
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const { pathname } = parse(request.url ?? "");

    if (pathname !== "/terminal" || !isAllowedOrigin(request.headers.origin)) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws, request) => {
    const { query } = parse(request.url ?? "", true);
    const conversationId = typeof query.conversationId === "string" ? query.conversationId : "";
    const token = typeof query.token === "string" ? query.token : "";

    if (!conversationId || !consumeTerminalToken(token, conversationId)) {
      ws.close(1008, "valid terminal token is required");
      return;
    }

    let shell: pty.IPty;
    let cwd = "";

    try {
      const conversation = getConversation(conversationId);
      cwd = conversation.workspacePath;
      shell = spawnShell(conversation.workspacePath);
    } catch (error) {
      ws.send(`\r\n${error instanceof Error ? error.message : "Terminal 启动失败。"}\r\n`);
      ws.close(1011);
      return;
    }

    ws.send(`AgentHub Terminal\r\ncwd: ${cwd}\r\n`);

    shell.onData((data) => sendIfOpen(ws, data));
    shell.onExit(({ exitCode }) => {
      sendIfOpen(ws, `\r\n[process exited with code ${exitCode}]\r\n`);
      ws.close();
    });

    ws.on("message", (data) => {
      shell.write(data.toString());
    });

    ws.on("close", () => {
      shell.kill();
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("无法启动 Terminal WebSocket 服务。");
  }

  return {
    port: address.port,
    server,
    wss
  };
}

function consumeTerminalToken(token: string, conversationId: string) {
  const tokens = terminalGlobal.__agentHubTerminalTokens;
  const record = tokens?.get(token);
  tokens?.delete(token);

  if (!record) {
    return false;
  }

  return record.conversationId === conversationId && record.expiresAt >= Date.now();
}

function isAllowedOrigin(origin: string | undefined) {
  if (!origin) {
    return false;
  }

  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function isTerminalEnabled() {
  return process.env.NODE_ENV !== "production" || process.env.AGENTHUB_ENABLE_TERMINAL === "1";
}

function spawnShell(cwd: string) {
  if (process.platform === "win32") {
    return pty.spawn("powershell.exe", ["-NoLogo", "-NoProfile"], {
      cwd,
      env: process.env,
      cols: 90,
      rows: 28
    });
  }

  return pty.spawn(process.env.SHELL || "bash", ["-l"], {
    cwd,
    env: process.env,
    cols: 90,
    rows: 28
  });
}

function sendIfOpen(ws: WebSocket, data: string) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(data);
  }
}
