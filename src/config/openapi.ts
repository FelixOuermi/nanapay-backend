import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const specPath = path.join(process.cwd(), "docs", "openapi.yaml");

export const openApiSpec = yaml.load(fs.readFileSync(specPath, "utf8")) as Record<string, unknown>;
