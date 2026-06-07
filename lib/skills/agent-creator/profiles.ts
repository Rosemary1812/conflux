import type { ToolProfile } from "@/lib/skills/agent-creator/types";

export type ProfileMeta = {
  /** Conflux 概念档位 */
  key: ToolProfile;
  /** 展示用名称 */
  name: string;
  /** 对非专业用户的简短解释 */
  description: string;
  /** 落到 Claude Agent SDK 时的 permissionMode（V3.4 启用） */
  permissionMode: "plan" | "acceptEdits" | "bypassPermissions";
  /** SDK allowedTools（V3.4 启用） */
  allowedTools: string[];
  /** SDK disallowedTools（V3.4 启用） */
  disallowedTools: string[];
  /** 是否需要 allowDangerouslySkipPermissions（V3.4 启用） */
  allowDangerouslySkipPermissions: boolean;
  /** 是否属于"高危"档；UI 上需要二次确认 */
  dangerous: boolean;
};

const readonlyProfile: ProfileMeta = {
  key: "readonly",
  name: "只读审查",
  description: "只读取与搜索代码，可向用户提问；不修改任何文件。",
  permissionMode: "plan",
  allowedTools: ["Read", "Glob", "Grep", "WebSearch", "WebFetch", "AskUserQuestion"],
  disallowedTools: ["Write", "Edit", "Bash"],
  allowDangerouslySkipPermissions: false,
  dangerous: false
};

const codeAuthorProfile: ProfileMeta = {
  key: "code-author",
  name: "可读写",
  description: "读取并修改本地代码与文档，自动批准 Edit/Write；禁止高危系统命令。",
  permissionMode: "acceptEdits",
  allowedTools: ["Read", "Glob", "Grep", "Edit", "Write", "AskUserQuestion"],
  disallowedTools: ["Bash(rm -rf *)", "Bash(sudo *)"],
  allowDangerouslySkipPermissions: false,
  dangerous: false
};

const executorProfile: ProfileMeta = {
  key: "executor",
  name: "全权限执行",
  description: "可执行任意命令并修改任意文件；用于需要跑构建 / 部署的场景。",
  permissionMode: "bypassPermissions",
  allowedTools: [],
  disallowedTools: ["Bash(rm -rf /)", "Bash(sudo *)"],
  allowDangerouslySkipPermissions: true,
  dangerous: true
};

const PROFILES: Record<ToolProfile, ProfileMeta> = {
  readonly: readonlyProfile,
  "code-author": codeAuthorProfile,
  executor: executorProfile
};

export function getProfileMeta(key: ToolProfile): ProfileMeta {
  return PROFILES[key];
}

export function listProfileMetas(): ProfileMeta[] {
  return [readonlyProfile, codeAuthorProfile, executorProfile];
}
