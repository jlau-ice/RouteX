import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import yaml from "yaml";

// Compile real library modules into an isolated temporary directory. Only external
// subscription / storage transports are replaced; the entire aggregation runs.
const root = path.resolve(import.meta.dirname, "..");
const folder = fs.mkdtempSync(
  path.join(root, "node_modules", ".routex-tests-"),
);
for (const file of fs.readdirSync(path.join(root, "lib"))) {
  if (file.endsWith(".ts"))
    fs.writeFileSync(
      path.join(folder, file.replace(/\.ts$/, ".js")),
      ts.transpileModule(
        fs.readFileSync(path.join(root, "lib", file), "utf8"),
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true,
          },
        },
      ).outputText,
    );
  else if (file.endsWith(".json"))
    fs.copyFileSync(path.join(root, "lib", file), path.join(folder, file));
}
const require = createRequire(import.meta.url);
const transport = require(path.join(folder, "subscription-fetch.js"));
const storage = require(path.join(folder, "supabase-storage.js"));
storage.loadBaseRules = async () => null;
const core = require(path.join(folder, "core.js"));
const validation = require(path.join(folder, "config-validation.js"));
const policies = require(path.join(folder, "policies.js"));
const proxy = (name, server = "node.example.com") => ({
  name,
  server,
  type: "trojan",
  port: 443,
  password: "fixture-password",
  sni: "example.com",
});
const fixtures = new Map([
  [
    "https://first.example/sub",
    { proxies: [proxy("US 1"), proxy("SG 1"), proxy("剩余流量：10 GB")] },
  ],
  [
    "https://second.example/sub",
    {
      proxies: [
        proxy("US 1", "second.example.com"),
        proxy("US 2"),
        proxy("US 2"),
      ],
    },
  ],
]);
transport.fetchSubscriptionText = async (url) => {
  if (!fixtures.has(url)) throw new Error("fixture unavailable");
  return {
    text: yaml.stringify(fixtures.get(url)),
    usage: "upload=10; download=20; total=100; expire=1800000000",
  };
};
const config = () => ({
  version: 1,
  subscriptions: [
    { id: "first", label: "First", url: "https://first.example/sub" },
    { id: "second", label: "Second", url: "https://second.example/sub" },
  ],
  groups: [],
  ruleMapping: [],
  customRules: [],
});
const render = async (value) => yaml.parse(await core.generateConfig(value));
const group = (out, name) =>
  out["proxy-groups"].find((item) => item.name === name);

test("real iKuuu defaults apply without a frontend preview", async () => {
  const out = await render(config());
  for (const name of [
    "🇨🇳 国内网站",
    "🌏 爱奇艺&哔哩哔哩",
    "🎮 Steam 登录/下载",
    "🎓学术网站",
  ])
    assert.deepEqual(group(out, name).proxies, ["DIRECT"]);
  assert.deepEqual(group(out, "🛑 拦截广告").proxies, ["REJECT"]);
  assert.deepEqual(group(out, "🐟 漏网之鱼").proxies, [policies.MAIN_GROUP]);
  assert.equal(out.rules.length, 9816);
});
test("same-name nodes from separate subscriptions remain distinct; notices and exact duplicates are removed", async () => {
  const out = await render(config());
  assert.equal(out.proxies.length, 4);
  assert.equal(
    out.proxies.find((p) => p.name === "[First] US 1").server,
    "node.example.com",
  );
  assert.equal(
    out.proxies.find((p) => p.name === "[Second] US 1").server,
    "second.example.com",
  );
  assert.deepEqual(group(out, "📦 Second").proxies, [
    "[Second] US 1",
    "[Second] US 2",
  ]);
});
test("source-scoped manual GPT nodes, default selection and domain precedence work together", async () => {
  const value = config();
  value.groups = [
    {
      id: "gpt",
      name: "GPT",
      type: "manual",
      sourceId: "second",
      nodes: ["[First] US 1", "[Second] US 1", "[Second] US 2"],
      preferred: "[Second] US 2",
    },
  ];
  value.customRules = [
    {
      type: "DOMAIN-SUFFIX",
      value: "https://chatgpt.com/chat\nopenai.com",
      group: "GPT",
    },
  ];
  const out = await render(value);
  assert.deepEqual(group(out, "GPT").proxies, [
    "[Second] US 2",
    "[Second] US 1",
  ]);
  assert.equal(group(out, "GPT")["default-selected"], "[Second] US 2");
  assert.deepEqual(out.rules.slice(0, 2), [
    "DOMAIN-SUFFIX,chatgpt.com,GPT",
    "DOMAIN-SUFFIX,openai.com,GPT",
  ]);
  assert.equal(out.profile["store-selected"], false);
});
test("an unavailable dedicated source never falls back to an unrelated same-name node", async () => {
  const value = config();
  value.subscriptions[1].url = "https://offline.example/sub";
  value.groups = [
    {
      id: "gpt",
      name: "GPT",
      type: "manual",
      sourceId: "second",
      nodes: ["[Second] US 1"],
    },
  ];
  value.customRules = [{ type: "DOMAIN", value: "chatgpt.com", group: "GPT" }];
  const out = await render(value);
  assert.deepEqual(group(out, "GPT").proxies, ["REJECT"]);
  assert.deepEqual(group(out, "📦 Second").proxies, ["REJECT"]);
  assert(out.rules[0].endsWith(",GPT"));
  assert((await core.previewConfig(value)).warnings.length > 0);
});
test("disabled sources retain stable source group identities and are not fetched", async () => {
  const value = config();
  value.subscriptions[0].enabled = false;
  const out = await render(value);
  assert.deepEqual(
    out.proxies.map((p) => p.name),
    ["[Second] US 1", "[Second] US 2"],
  );
  assert.equal(
    (await core.previewConfig(value)).subscriptions[0].status,
    "disabled",
  );
});
test("regular-expression groups, automatic latency selection and ordered failover are generated", async () => {
  const value = config();
  value.groups = [
    {
      id: "auto",
      name: "Auto",
      type: "auto",
      sourceId: "second",
      pattern: "US",
      strategy: "url-test",
    },
    {
      id: "fallback",
      name: "Backup",
      type: "all",
      strategy: "fallback",
      preferred: "[First] SG 1",
    },
  ];
  const out = await render(value);
  assert.equal(group(out, "Auto").type, "url-test");
  assert.equal(group(out, "Auto").proxies.length, 2);
  assert.equal(group(out, "Backup").type, "fallback");
  assert.equal(group(out, "Backup").proxies[0], "[First] SG 1");
});
test("invalid targets fail closed and explicit empty mappings do not expand to all nodes", async () => {
  const value = config();
  value.ruleMapping = [{ category: "🐟 漏网之鱼", group: "", targets: [] }];
  value.customRules = [
    { type: "DOMAIN", value: "private.example", group: "missing" },
  ];
  const out = await render(value);
  assert.deepEqual(group(out, "🐟 漏网之鱼").proxies, ["REJECT"]);
  assert.equal(out.rules[0], "DOMAIN,private.example,REJECT");
});
test("cycles and reserved group names are rejected", async () => {
  const value = config();
  value.ruleMapping = [{ category: policies.MAIN_GROUP, group: "🐟 漏网之鱼" }];
  await assert.rejects(render(value), /循环/);
  value.ruleMapping = [];
  value.groups = [{ id: "bad", name: "DIRECT", type: "all" }];
  assert.match(validation.validateAppConfig(value), /重名/);
});
test("IPv4/IPv6 CIDR and raw domain rules preserve targets and no-resolve", async () => {
  const value = config();
  value.customRules = [
    {
      type: "IP-CIDR",
      value: "8.8.8.8\n2001:4860:4860::8888",
      group: "DIRECT",
    },
    { type: "RAW", value: "DOMAIN,example.org,REJECT\n# comment", group: "" },
  ];
  const out = await render(value);
  assert.deepEqual(out.rules.slice(0, 3), [
    "IP-CIDR,8.8.8.8/32,DIRECT,no-resolve",
    "IP-CIDR6,2001:4860:4860::8888/128,DIRECT,no-resolve",
    "DOMAIN,example.org,REJECT",
  ]);
});
test("bad config, abusive regex and private network requests are rejected", async () => {
  assert(validation.validateAppConfig({}));
  const value = config();
  value.groups = [{ id: "bad", name: "Bad", type: "auto", pattern: "(a+)+$" }];
  assert.match(validation.validateAppConfig(value), /正则/);
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "198.18.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
  ])
    assert.equal(transport.isPublicAddress(address), false, address);
  assert.equal(transport.isPublicAddress("43.162.100.65"), true);
  assert.equal(transport.isPublicAddress("2606:4700:4700::1111"), true);
});
test("no subscriptions / all failed produce useful errors", async () => {
  const value = config();
  value.subscriptions = [];
  await assert.rejects(render(value), /至少/);
  value.subscriptions = [{ url: "https://offline.example/sub" }];
  await assert.rejects(render(value), /没有|未获得/);
});
test("every generated rule and policy references an existing target", async () => {
  const out = await render(config());
  const names = [
    ...out.proxies.map((p) => p.name),
    ...out["proxy-groups"].map((g) => g.name),
  ];
  assert.equal(new Set(names).size, names.length);
  const known = new Set([...names, "DIRECT", "REJECT", "PASS", "REJECT-DROP"]);
  for (const g of out["proxy-groups"])
    for (const member of g.proxies) assert(known.has(member));
  for (const rule of out.rules) {
    const parts = rule.split(",");
    assert(
      known.has(parts.at(-1) === "no-resolve" ? parts.at(-2) : parts.at(-1)),
    );
  }
});
after(() => fs.rmSync(folder, { recursive: true, force: true }));
