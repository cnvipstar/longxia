import { describe, expect, it, vi, beforeEach } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import type { HookStatusReport } from "../hooks/hooks-status.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import { setupInternalHooks } from "./onboard-hooks.js";

function isHooksEnablePrompt(message: string): boolean {
  return message === "Enable hooks?" || message === "启用 hooks？";
}

function isSkipNowLabel(label: string): boolean {
  return label === "Skip for now" || label === "暂时跳过";
}

function isNoHooksMessage(message: string): boolean {
  return (
    message === "No eligible hooks found. You can configure hooks later in your config." ||
    message === "未发现可启用的 hooks。你可以稍后在配置文件中手动设置。"
  );
}

function isNoHooksTitle(title: string): boolean {
  return title === "No Hooks Available" || title === "无可用 Hooks";
}

// Mock hook discovery modules
vi.mock("../hooks/hooks-status.js", () => ({
  buildWorkspaceHookStatus: vi.fn(),
}));

vi.mock("../agents/agent-scope.js", () => ({
  resolveAgentWorkspaceDir: vi.fn().mockReturnValue("/mock/workspace"),
  resolveDefaultAgentId: vi.fn().mockReturnValue("main"),
}));

describe("onboard-hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createMockPrompter = (multiselectValue: string[]): WizardPrompter => ({
    confirm: vi.fn().mockResolvedValue(true),
    note: vi.fn().mockResolvedValue(undefined),
    intro: vi.fn().mockResolvedValue(undefined),
    outro: vi.fn().mockResolvedValue(undefined),
    text: vi.fn().mockResolvedValue(""),
    select: vi.fn().mockResolvedValue(""),
    multiselect: vi.fn().mockResolvedValue(multiselectValue),
    progress: vi.fn().mockReturnValue({
      stop: vi.fn(),
      update: vi.fn(),
    }),
  });

  const createMockRuntime = (): RuntimeEnv => ({
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  });

  const createMockHook = (
    params: {
      name: string;
      description: string;
      filePath: string;
      baseDir: string;
      handlerPath: string;
      hookKey: string;
      emoji: string;
      events: string[];
    },
    eligible: boolean,
  ) => ({
    ...params,
    source: "openclaw-bundled" as const,
    pluginId: undefined,
    homepage: undefined,
    always: false,
    disabled: false,
    eligible,
    managedByPlugin: false,
    requirements: {
      bins: [],
      anyBins: [],
      env: [],
      config: ["workspace.dir"],
      os: [],
    },
    missing: {
      bins: [],
      anyBins: [],
      env: [],
      config: eligible ? [] : ["workspace.dir"],
      os: [],
    },
    configChecks: [],
    install: [],
  });

  const createMockHookReport = (eligible = true): HookStatusReport => ({
    workspaceDir: "/mock/workspace",
    managedHooksDir: "/mock/.openclaw/hooks",
    hooks: [
      createMockHook(
        {
          name: "session-memory",
          description: "Save session context to memory when /new command is issued",
          filePath: "/mock/workspace/hooks/session-memory/HOOK.md",
          baseDir: "/mock/workspace/hooks/session-memory",
          handlerPath: "/mock/workspace/hooks/session-memory/handler.js",
          hookKey: "session-memory",
          emoji: "💾",
          events: ["command:new"],
        },
        eligible,
      ),
      createMockHook(
        {
          name: "command-logger",
          description: "Log all command events to a centralized audit file",
          filePath: "/mock/workspace/hooks/command-logger/HOOK.md",
          baseDir: "/mock/workspace/hooks/command-logger",
          handlerPath: "/mock/workspace/hooks/command-logger/handler.js",
          hookKey: "command-logger",
          emoji: "📝",
          events: ["command"],
        },
        eligible,
      ),
    ],
  });

  async function runSetupInternalHooks(params: {
    selected: string[];
    cfg?: OpenClawConfig;
    eligible?: boolean;
  }) {
    const { buildWorkspaceHookStatus } = await import("../hooks/hooks-status.js");
    vi.mocked(buildWorkspaceHookStatus).mockReturnValue(
      createMockHookReport(params.eligible ?? true),
    );

    const cfg = params.cfg ?? {};
    const prompter = createMockPrompter(params.selected);
    const runtime = createMockRuntime();
    const result = await setupInternalHooks(cfg, runtime, prompter);
    return { result, cfg, prompter };
  }

  describe("setupInternalHooks", () => {
    it("should enable hooks when user selects them", async () => {
      const { result, prompter } = await runSetupInternalHooks({
        selected: ["session-memory"],
      });

      expect(result.hooks?.internal?.enabled).toBe(true);
      expect(result.hooks?.internal?.entries).toEqual({
        "session-memory": { enabled: true },
      });
      expect(prompter.note).toHaveBeenCalledTimes(2);

      const args = (prompter.multiselect as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
        | { message: string; options: Array<{ value: string; label: string; hint?: string }> }
        | undefined;
      expect(args).toBeDefined();
      expect(isHooksEnablePrompt(args?.message ?? "")).toBe(true);
      expect(isSkipNowLabel(args?.options?.[0]?.label ?? "")).toBe(true);
    });

    it("should not enable hooks when user skips", async () => {
      const { result, prompter } = await runSetupInternalHooks({
        selected: ["__skip__"],
      });

      expect(result.hooks?.internal).toBeUndefined();
      expect(prompter.note).toHaveBeenCalledTimes(1);
    });

    it("should handle no eligible hooks", async () => {
      const { result, cfg, prompter } = await runSetupInternalHooks({
        selected: [],
        eligible: false,
      });

      expect(result).toEqual(cfg);
      expect(prompter.multiselect).not.toHaveBeenCalled();
      const matched = (prompter.note as ReturnType<typeof vi.fn>).mock.calls.some(
        ([message, title]) => isNoHooksMessage(String(message)) && isNoHooksTitle(String(title)),
      );
      expect(matched).toBe(true);
    });

    it("should preserve existing hooks config when enabled", async () => {
      const cfg: OpenClawConfig = {
        hooks: {
          enabled: true,
          path: "/webhook",
          token: "existing-token",
        },
      };
      const { result } = await runSetupInternalHooks({
        selected: ["session-memory"],
        cfg,
      });

      expect(result.hooks?.enabled).toBe(true);
      expect(result.hooks?.path).toBe("/webhook");
      expect(result.hooks?.token).toBe("existing-token");
      expect(result.hooks?.internal?.enabled).toBe(true);
      expect(result.hooks?.internal?.entries).toEqual({
        "session-memory": { enabled: true },
      });
    });

    it("should preserve existing config when user skips", async () => {
      const cfg: OpenClawConfig = {
        agents: { defaults: { workspace: "/workspace" } },
      };
      const { result } = await runSetupInternalHooks({
        selected: ["__skip__"],
        cfg,
      });

      expect(result).toEqual(cfg);
      expect(result.agents?.defaults?.workspace).toBe("/workspace");
    });

    it("should show informative notes to user", async () => {
      const { prompter } = await runSetupInternalHooks({
        selected: ["session-memory"],
      });

      const noteCalls = (prompter.note as ReturnType<typeof vi.fn>).mock.calls;
      expect(noteCalls).toHaveLength(2);

      // First note should explain what hooks are
      expect(
        String(noteCalls[0][0]).includes("Hooks let you automate actions") ||
          String(noteCalls[0][0]).includes("Hooks 可在 Agent 命令触发时自动执行动作。"),
      ).toBe(true);

      // Second note should confirm configuration
      expect(
        String(noteCalls[1][0]).includes("Enabled 1 hook: session-memory") ||
          String(noteCalls[1][0]).includes("已启用 1 个 hook：session-memory"),
      ).toBe(true);
      expect(noteCalls[1][0]).toMatch(/(?:openclaw|openclaw)( --profile isolated)? hooks list/);
    });
  });
});
