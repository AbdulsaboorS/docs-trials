import { recoverRunLocks } from "../core/run";

export async function recover(
  run: string,
  force = false,
): Promise<{ runId: string; removed: string[] }> {
  return recoverRunLocks(run, undefined, force);
}
