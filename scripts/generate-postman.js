// Genere docs/NanoPay.postman_collection.json a partir de docs/openapi.yaml
// (une seule source de verite pour le contrat d'API).
//
// Usage : npm run docs:postman
//
// Variables de collection : baseUrl, accessToken, refreshToken. La requete "Connexion"
// enregistre automatiquement accessToken / refreshToken via un script de test.

const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const specPath = path.join(__dirname, "..", "docs", "openapi.yaml");
const outPath = path.join(__dirname, "..", "docs", "NanoPay.postman_collection.json");
const spec = yaml.load(fs.readFileSync(specPath, "utf8"));

const resolve = (node) => {
  if (node && node.$ref) {
    return node.$ref
      .replace("#/", "")
      .split("/")
      .reduce((acc, key) => acc[key], spec);
  }
  return node;
};

function sample(schema) {
  schema = resolve(schema);
  if (!schema) return null;
  if (schema.example !== undefined) return schema.example;
  if (schema.enum) return schema.enum[0];
  switch (schema.type) {
    case "object": {
      const out = {};
      for (const [key, value] of Object.entries(schema.properties || {})) {
        const s = resolve(value);
        if (s.format === "binary") continue;
        out[key] = sample(s);
      }
      return out;
    }
    case "array":
      return [sample(schema.items)];
    case "integer":
      return schema.minimum ?? 1;
    case "number":
      return 0.1;
    case "boolean":
      return true;
    case "string":
      if (schema.format === "email") return "client@nanopay.test";
      if (schema.format === "date-time") return new Date().toISOString();
      return "string";
    default:
      return null;
  }
}

const folders = new Map();
const bearerNeeded = (op) => !(Array.isArray(op.security) && op.security.length === 0);

for (const [route, methods] of Object.entries(spec.paths)) {
  for (const [method, rawOp] of Object.entries(methods)) {
    const op = resolve(rawOp);
    const tag = (op.tags && op.tags[0]) || "Autres";
    const parameters = (op.parameters || []).map(resolve);

    const url = "{{baseUrl}}" + route.replace(/\{(\w+)\}/g, ":$1");
    const query = parameters.filter((p) => p.in === "query" && p.required).map((p) => ({ key: p.name, value: "" }));
    const variable = parameters.filter((p) => p.in === "path").map((p) => ({ key: p.name, value: "" }));
    const header = [];

    for (const p of parameters.filter((p) => p.in === "header")) header.push({ key: p.name, value: "" });

    const item = {
      name: `${method.toUpperCase()} ${route}${op.summary ? ` — ${op.summary}` : ""}`,
      request: {
        method: method.toUpperCase(),
        header,
        url: { raw: url, host: ["{{baseUrl}}"], path: route.replace(/\{(\w+)\}/g, ":$1").split("/").filter(Boolean), query, variable },
        description: op.description || op.summary || "",
      },
    };

    if (bearerNeeded(op)) {
      item.request.auth = { type: "bearer", bearer: [{ key: "token", value: "{{accessToken}}", type: "string" }] };
    } else {
      item.request.auth = { type: "noauth" };
    }

    const body = resolve(op.requestBody);
    const content = body && body.content;
    if (content && content["application/json"]) {
      item.request.header.push({ key: "Content-Type", value: "application/json" });
      item.request.body = { mode: "raw", raw: JSON.stringify(sample(content["application/json"].schema), null, 2) };
    } else if (content && content["multipart/form-data"]) {
      const props = resolve(content["multipart/form-data"].schema).properties || {};
      item.request.body = {
        mode: "formdata",
        formdata: Object.entries(props).map(([key, value]) => {
          const s = resolve(value);
          return s.format === "binary" || (s.type === "array" && resolve(s.items).format === "binary")
            ? { key, type: "file", src: [] }
            : { key, type: "text", value: String(sample(s) ?? "") };
        }),
      };
    }

    if (route === "/auth/login") {
      item.event = [
        {
          listen: "test",
          script: {
            type: "text/javascript",
            exec: [
              "const res = pm.response.json();",
              "if (res.data && res.data.accessToken) {",
              "  pm.collectionVariables.set('accessToken', res.data.accessToken);",
              "  pm.collectionVariables.set('refreshToken', res.data.refreshToken);",
              "}",
            ],
          },
        },
      ];
    }

    if (!folders.has(tag)) folders.set(tag, []);
    folders.get(tag).push(item);
  }
}

const collection = {
  info: {
    name: "NanoPay API",
    description: "Collection generee depuis docs/openapi.yaml (npm run docs:postman).",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  variable: [
    { key: "baseUrl", value: "http://localhost:4000/api" },
    { key: "accessToken", value: "" },
    { key: "refreshToken", value: "" },
  ],
  item: [...folders.entries()].map(([name, item]) => ({ name, item })),
};

fs.writeFileSync(outPath, JSON.stringify(collection, null, 2) + "\n");
console.log(`Collection ecrite : ${path.relative(process.cwd(), outPath)} (${[...folders.values()].flat().length} requetes)`);
