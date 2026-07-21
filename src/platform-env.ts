import type { BrowserWorker } from "@cloudflare/playwright";
import type { Sandbox } from "@cloudflare/sandbox";
import type { RunAdmission } from "./run-admission";
import type { TrialCodingAgent } from "./trial-agent";
import type { TrialWorkflowInput } from "./trial-workflow";

export interface PlatformEnv {
  AI: Ai;
  ASSETS: Fetcher;
  BROWSER: BrowserWorker;
  LOADER: WorkerLoader;
  RunAdmission: DurableObjectNamespace<RunAdmission>;
  Sandbox: DurableObjectNamespace<Sandbox>;
  TrialCodingAgent: DurableObjectNamespace<TrialCodingAgent>;
  TRIAL_WORKFLOW: Workflow<TrialWorkflowInput>;
  ACCESS_AUD?: string;
  ACCESS_TEAM_DOMAIN?: string;
  AI_GATEWAY_URL?: string;
  ARTIFACTS_NAMESPACE?: string;
  CF_API_TOKEN?: string;
  REALTIMEKIT_AUTH_ENDPOINT?: string;
  REALTIMEKIT_ROOM_NAME?: string;
}
