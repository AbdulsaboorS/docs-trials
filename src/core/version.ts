import packageMetadata from "../../package.json" with { type: "json" };

export const cliVersion = packageMetadata.version;
export const schemaVersion = 1;
