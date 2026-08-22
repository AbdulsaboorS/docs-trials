const safeBaseNames = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SHELL",
  "LANG",
  "LC_ALL",
  "SystemRoot",
  "ComSpec",
  "PATHEXT",
] as const;

export type CommandEnvironment = {
  values: NodeJS.ProcessEnv;
  present: string[];
  missing: string[];
};

export function commandEnvironment(
  allowedNames: readonly string[],
  fixed: Readonly<Record<string, string>>,
): CommandEnvironment {
  const values: NodeJS.ProcessEnv = {};
  for (const name of safeBaseNames) {
    const value = process.env[name];
    if (value !== undefined) values[name] = value;
  }

  const present: string[] = [];
  const missing: string[] = [];
  for (const name of allowedNames) {
    const value = process.env[name];
    if (value === undefined) missing.push(name);
    else {
      values[name] = value;
      present.push(name);
    }
  }
  Object.assign(values, fixed);
  return { values, present, missing };
}

export function describeCommandEnvironment(selection: CommandEnvironment): string {
  const present = selection.present.length > 0 ? selection.present.join(", ") : "none";
  const missing = selection.missing.length > 0 ? selection.missing.join(", ") : "none";
  return `Approved environment names present: ${present}. Missing: ${missing}.`;
}
