export const approvedTrialTools = [
  "fetch_url",
  "workspace_list_files",
  "workspace_read_file",
  "workspace_write_file",
] as const;

const approved = new Set<string>(approvedTrialTools);
const writableWorkspacePaths = new Set(["src/App.jsx", "src/styles.css"]);

export function isApprovedTrialTool(name: string): boolean {
  return approved.has(name);
}

export function resolveWorkspacePath(relativePath: string): string {
  if (
    relativePath.startsWith("/") ||
    relativePath.split("/").some((part) => part === ".." || part === "")
  ) {
    throw new Error("Workspace path must be a normalized relative path.");
  }
  return `/workspace/app/${relativePath}`;
}

export function resolveWritableWorkspacePath(relativePath: string): string {
  if (!writableWorkspacePaths.has(relativePath)) {
    throw new Error("Workspace file is not writable for this frozen trial.");
  }
  return resolveWorkspacePath(relativePath);
}
