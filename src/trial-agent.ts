import {
  Think,
  type ToolCallContext,
  type ToolCallDecision,
  type TurnConfig,
} from "@cloudflare/think";
import { z } from "zod";
import type { PlatformEnv } from "./platform-env";
import { internalRunPolicy } from "./run-policy";
import { getTrialSandbox } from "./sandbox-executor";
import {
  approvedTrialTools,
  isApprovedTrialTool,
  resolveWorkspacePath,
  resolveWritableWorkspacePath,
} from "./trial-tool-policy";

export class TrialCodingAgent extends Think<PlatformEnv> {
  override workspaceBash = false;
  override maxSteps = internalRunPolicy.limits.maxAgentSteps;

  override fetchTools = {
    allowlist: [
      "https://react.dev/learn/state-a-components-memory",
      "https://react.dev/learn/conditional-rendering",
    ],
    maxBytes: 250_000,
    maxModelChars: 30_000,
  };

  override getModel() {
    return "@cf/moonshotai/kimi-k2.7-code";
  }

  override getSystemPrompt() {
    return [
      "You are the controlled coding agent for a Docs Trials run.",
      "Use only the task resources exposed by fetch_url and the Sandbox workspace tools.",
      "Do not retrieve unrelated documentation or use prior assumptions as evidence.",
      "Never write a persistent credential to generated source, client code, or logs.",
      "Edit only files under the supplied workspace. Do not install packages or start services.",
      "You do not decide pass or fail. Finish after implementing the frozen task.",
    ].join(" ");
  }

  override getTools() {
    const sandbox = getTrialSandbox(this.env, this.name);
    const sessionId = `run-${this.name}`;

    return {
      workspace_list_files: {
        description: "List files in the trial workspace.",
        inputSchema: z.object({ path: z.string().default(".") }),
        execute: async ({ path }: { path: string }) => {
          const session = await sandbox.getSession(sessionId);
          const target = path === "." ? "/workspace/app" : resolveWorkspacePath(path);
          const result = await session.listFiles(target, { recursive: true, includeHidden: true });
          return result.files
            .filter((file) => !file.relativePath.split("/").includes("node_modules"))
            .map((file) => ({ path: file.relativePath, type: file.type, size: file.size }));
        },
      },
      workspace_read_file: {
        description: "Read a UTF-8 text file from the trial workspace.",
        inputSchema: z.object({ path: z.string().min(1) }),
        execute: async ({ path }: { path: string }) => {
          const session = await sandbox.getSession(sessionId);
          const result = await session.readFile(resolveWorkspacePath(path));
          if (new TextEncoder().encode(result.content).byteLength > 200_000) {
            throw new Error("Workspace file exceeds the read limit.");
          }
          return result.content;
        },
      },
      workspace_write_file: {
        description: "Write a UTF-8 text file inside the trial workspace.",
        inputSchema: z.object({ path: z.string().min(1), content: z.string() }),
        execute: async ({ path, content }: { path: string; content: string }) => {
          if (new TextEncoder().encode(content).byteLength > 200_000) {
            throw new Error("Workspace file exceeds the write limit.");
          }
          const session = await sandbox.getSession(sessionId);
          const result = await session.writeFile(resolveWritableWorkspacePath(path), content);
          return { path: result.path, written: result.success };
        },
      },
    };
  }

  override beforeTurn(): TurnConfig {
    return {
      activeTools: [...approvedTrialTools],
      maxSteps: internalRunPolicy.limits.maxAgentSteps,
      maxRetries: 1,
      maxOutputTokens: 4_000,
      sendReasoning: false,
      timeout: { totalMs: internalRunPolicy.limits.maxBrowserSeconds * 1_000 },
    };
  }

  override beforeToolCall(ctx: ToolCallContext): ToolCallDecision | void {
    if (!isApprovedTrialTool(ctx.toolName)) {
      return { action: "block", reason: "This tool is not approved for the frozen trial." };
    }
  }
}
