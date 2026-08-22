import { trackInterruptCleanup } from "../../src/util/process";

trackInterruptCleanup(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  process.stdout.write("CHILDREN\n");
  trackInterruptCleanup(async () => {
    process.stdout.write("CHILDREN-LATE\n");
  }, "children");
}, "children");
trackInterruptCleanup(async () => {
  process.stdout.write("STATE\n");
});
trackInterruptCleanup(async () => {
  process.stdout.write("OWNER\n");
}, "owner");

process.stdout.write("READY\n");
setInterval(() => undefined, 1_000);
