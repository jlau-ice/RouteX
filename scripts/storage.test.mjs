import { PGlite } from "@electric-sql/pglite";
import { test } from "node:test";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
test("cloud storage schema and capability permissions", async () => {
  const db = new PGlite();
  await db.exec(
    "create role anon; create role authenticated; create role service_role; grant usage on schema public to anon, authenticated, service_role;",
  );
  const schema = await fs.readFile(
    new URL("../supabase/schema.sql", import.meta.url),
    "utf8",
  );
  await db.exec(schema);
  await db.exec(schema);
  const config = {
    version: 1,
    subscriptions: [{ url: "https://fixture.example/sub" }],
    groups: [],
    ruleMapping: [],
    customRules: [],
  };
  const hash = createHash("sha256").update(randomBytes(32)).digest("hex");
  async function anon(sql, args = []) {
    await db.exec("begin; set local role anon;");
    try {
      const result = await db.query(sql, args);
      await db.exec("commit;");
      return result.rows;
    } catch (e) {
      await db.exec("rollback;");
      throw e;
    }
  }
  const [result] = await anon(
    "select public.save_routex_config_v2($1,$2) as id",
    [config, hash],
  );
  const id = result.id;
  assert(id);
  assert.deepEqual(await anon("select * from public.routex_configs"), []);
  const [loaded] = await anon("select public.get_routex_config($1) as config", [
    id,
  ]);
  assert.deepEqual(loaded.config, config);
  const [invalid] = await anon(
    "select public.get_routex_config_for_edit($1,$2) as config",
    [id, "0".repeat(64)],
  );
  assert.equal(invalid.config, null);
  config.groups = [
    { id: "manual", name: "GPT", type: "manual", nodes: ["node-a"] },
  ];
  const [badUpdate] = await anon(
    "select public.update_routex_config($1,$2,$3) as ok",
    [id, "0".repeat(64), config],
  );
  assert.equal(badUpdate.ok, false);
  const [update] = await anon(
    "select public.update_routex_config($1,$2,$3) as ok",
    [id, hash, config],
  );
  assert.equal(update.ok, true);
  const [edited] = await anon(
    "select public.get_routex_config_for_edit($1,$2) as config",
    [id, hash],
  );
  assert.deepEqual(edited.config, config);
  assert.deepEqual(
    await anon(
      "update public.routex_configs set config=$1 where id=$2 returning id",
      [config, id],
    ),
    [],
  );
  await assert.rejects(
    anon("insert into public.routex_configs (config) values ($1)", [config]),
    /row-level security/,
  );
  await assert.rejects(
    anon("delete from public.routex_configs where id=$1", [id]),
    /permission denied/,
  );
  console.log(
    "PASS: schema applies twice; create/read/update with credentials; anonymous enumeration/direct insert/update/delete denied; incorrect edit key denied.",
  );
  await db.close();
});
