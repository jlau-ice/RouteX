import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";

test("PostgreSQL storage persists configurations and enforces edit credentials without Supabase", async (t) => {
  const root = path.resolve(import.meta.dirname, "..");
  const folder = await fs.mkdtemp(path.join(root, "node_modules", ".routex-pg-tests-"));
  const db = new PGlite();
  const oldUrl = process.env.DATABASE_URL;
  const require = createRequire(import.meta.url);
  try {
    const schema = await fs.readFile(path.join(root, "postgres/schema.sql"), "utf8");
    await db.exec(schema);
    await db.exec(schema);
    for (const file of await fs.readdir(path.join(root, "lib"))) {
      if (!file.endsWith(".ts")) continue;
      const source = await fs.readFile(path.join(root, "lib", file), "utf8");
      await fs.writeFile(path.join(folder, file.replace(/\.ts$/, ".js")), ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      }).outputText);
    }
    // Only the transport is substituted: production SQL runs against PostgreSQL.
    const pg = require("pg");
    t.mock.method(pg, "Pool", function () {
      return {
        on() {},
        async end() {},
        async query(sql, values) {
          const result = await db.query(sql, values);
          return { rows: result.rows, rowCount: result.affectedRows };
        },
      };
    });
    t.mock.method(globalThis, "fetch", async () => { throw new Error("Local mode contacted Supabase"); });
    process.env.DATABASE_URL = "postgresql://fixture.invalid/routex";
    const storage = require(path.join(folder, "storage.js"));
    assert.equal(storage.getStorageMode(), "postgres");
    assert.equal(await storage.loadBaseRules(), null);
    const config = {
      version: 1,
      subscriptions: [{ id: "first", label: "O'Reilly's nodes", url: "https://fixture.example/sub" }],
      groups: [], ruleMapping: [], customRules: [],
    };
    const editKey = randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(editKey).digest("hex");
    const id = await storage.saveConfig(config, hash);
    assert(storage.isConfigId(id));
    assert.deepEqual(await storage.loadConfig(id), config);
    assert.deepEqual(await storage.loadEditableConfig(id, hash), config);
    assert.equal(await storage.loadEditableConfig(id, "0".repeat(64)), null);
    assert.equal(await storage.loadConfig("' or true --"), null);
    assert.equal(await storage.loadConfig(randomUUID()), null);
    const updated = { ...config, customRules: [{ type: "DOMAIN-SUFFIX", value: "example.org", group: "DIRECT" }] };
    assert.equal(await storage.updateConfig(id, "0".repeat(64), updated), false);
    assert.deepEqual(await storage.loadConfig(id), config);
    assert.equal(await storage.updateConfig(id, hash, updated), true);
    assert.deepEqual(await storage.loadEditableConfig(id, hash), updated);
    const { rows } = await db.query("select id, edit_secret_hash from public.routex_configs");
    assert.deepEqual(rows, [{ id, edit_secret_hash: hash }]);
    assert.notEqual(rows[0].edit_secret_hash, editKey);
    await assert.rejects(storage.saveConfig(config, "bad-hash"), /Invalid edit secret hash/);
    await assert.rejects(storage.saveConfig({ ...config, version: 9 }, hash));

    // Missing or blank DATABASE_URL preserves the existing cloud backend.
    process.env.DATABASE_URL = " ";
    assert.equal(storage.getStorageMode(), "supabase");
    t.mock.method(globalThis, "fetch", async (url) => {
      assert(String(url).endsWith("/rpc/get_routex_base_rules"));
      return Response.json(["MATCH,DIRECT"]);
    });
    assert.deepEqual(await storage.loadBaseRules(), ["MATCH,DIRECT"]);
  } finally {
    if (oldUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = oldUrl;
    delete globalThis.routexPostgres;
    await db.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
});
