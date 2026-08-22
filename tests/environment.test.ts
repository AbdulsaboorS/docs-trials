import { afterEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "../src/checks/command";

afterEach(() => vi.unstubAllEnvs());

describe("lifecycle command environment", () => {
  it("does not expose an undeclared operator variable", async () => {
    vi.stubEnv("DOCS_TRIALS_PRIVATE_VALUE", "must-not-reach-child");

    const outcome = await runCommand(
      'node -e "process.exit(process.env.DOCS_TRIALS_PRIVATE_VALUE ? 9 : 0)"',
      process.cwd(),
      10,
    );

    expect(outcome.exitCode).toBe(0);
    expect(outcome.output).toContain("Approved environment names present: none");
    expect(outcome.output).not.toContain("must-not-reach-child");
  });

  it("exposes a declared variable by name without recording its value", async () => {
    vi.stubEnv("DOCS_TRIALS_APPROVED_VALUE", "approved-child-value");

    const outcome = await runCommand(
      'node -e "process.exit(process.env.DOCS_TRIALS_APPROVED_VALUE ? 0 : 9)"',
      process.cwd(),
      10,
      ["DOCS_TRIALS_APPROVED_VALUE"],
    );

    expect(outcome.exitCode).toBe(0);
    expect(outcome.output).toContain("DOCS_TRIALS_APPROVED_VALUE");
    expect(outcome.output).not.toContain("approved-child-value");
  });

  it.skipIf(process.platform === "win32")(
    "retains signal termination as infrastructure evidence",
    async () => {
      const outcome = await runCommand("kill -TERM $$", process.cwd(), 10);

      expect(outcome.exitCode).toBeNull();
      expect(outcome.signalCode).toBe("SIGTERM");
      expect(outcome.output).toContain("signal SIGTERM");
    },
  );
});
