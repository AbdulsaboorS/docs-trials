import { trialSpecSchema, type TrialSpec } from "./domain";

export const realtimekitTrial: TrialSpec = trialSpecSchema.parse({
  id: "realtimekit-video-room-v1",
  title: "RealtimeKit two-participant React video room",
  task: "Using only the supplied RealtimeKit documentation and starter repository, build a React application that allows two browser participants to join the same video room, publish camera and microphone media, see each other, leave, and rejoin.",
  starterRepository: {
    source: "https://github.com/cloudflare/docs-trials-realtimekit-starter",
    revision: "fixture-v1",
  },
  resources: [
    {
      kind: "website",
      locator: "https://docs.realtimekit.io/",
      retrievedAt: "2026-07-16T00:00:00.000Z",
    },
  ],
  runtime: {
    installCommand: "pnpm install --frozen-lockfile --ignore-scripts",
    buildCommand: "pnpm build",
    startCommand: "pnpm dev --host 0.0.0.0",
  },
  acceptanceCriteria: [
    "The generated project installs and builds successfully.",
    "The generated application starts and exposes a reachable preview URL.",
    "Participant A can join the configured test room.",
    "Participant B can join the same room in a separate browser context.",
    "Each participant's UI reflects that two participants are present.",
    "Each participant can publish camera and microphone media using supplied test capabilities or controlled substitutes.",
    "Leaving removes a participant from the other participant's UI.",
    "Rejoining restores two-participant state.",
    "No persistent token or room credential is present in browser-delivered JavaScript, source maps, DOM content, screenshots, or saved logs.",
    "The browser console and network checks contain no unhandled application error.",
  ],
});

export const updatesFilterCriteria = {
  build: "The generated project installs and builds successfully.",
  preview: "The generated application starts and exposes a reachable preview URL.",
  initial: "The Updates page initially shows all three supplied updates.",
  filter: "Selecting the Platform topic shows only the Platform update.",
  empty: "Selecting the Archived topic shows the No updates found message.",
  network: "The page makes no unexpected external runtime data request.",
  errors: "The browser console and network checks contain no unhandled application error.",
} as const;

export const updatesFilterSmokeTrial: TrialSpec = trialSpecSchema.parse({
  id: "updates-filter-smoke-v1",
  title: "Updates filter controlled-cloud smoke trial",
  task: `Using only the supplied React documentation and starter, build an Updates page. Show these three updates: Faster previews (Platform), Clearer evidence (Evidence), and Safer trial limits (Safety). Render each update as an article. Provide one visible button for each filter named All, Platform, Evidence, Safety, and Archived. Initially show all three updates. A topic filter must show only matching updates. When a filter has no matches, show "No updates found." Do not add authentication, external services, or network data fetching.`,
  starterRepository: {
    source: "builtin:updates-filter-starter-v1",
    revision: "sha256:7a0b1f1d7f2a85859bb2393676e092664d23b1a922d6109b6d75b6f75ba0b740",
  },
  resources: [
    {
      kind: "website",
      locator: "https://react.dev/learn/state-a-components-memory",
      retrievedAt: "2026-07-20T00:00:00.000Z",
    },
    {
      kind: "website",
      locator: "https://react.dev/learn/conditional-rendering",
      retrievedAt: "2026-07-20T00:00:00.000Z",
    },
  ],
  runtime: {
    installCommand: "pnpm install --frozen-lockfile --ignore-scripts",
    buildCommand: "pnpm build",
    startCommand: "pnpm dev --host 0.0.0.0 --port 4173",
  },
  acceptanceCriteria: Object.values(updatesFilterCriteria),
});
