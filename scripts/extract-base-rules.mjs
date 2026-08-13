// 一次性脚本：从本机 iKuuu 订阅缓存里提取规则，生成内置规则集 lib/base-rules.json
// 规则只是域名/IP，不含订阅 token，可安全提交进仓库。
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
// iKuuu 的本地缓存（Clash Verge profiles 目录）
const ikuuuCache =
  `${os.homedir()}/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/profiles/Rv0fAb8ZAcTH.yaml`;

const cfg = yaml.parse(readFileSync(ikuuuCache, "utf-8"));
const rules = Array.isArray(cfg?.rules) ? cfg.rules : [];
if (rules.length === 0) {
  console.error("未提取到规则，请检查 iKuuu 缓存文件：", ikuuuCache);
  process.exit(1);
}

const out = path.join(here, "..", "lib", "base-rules.json");
writeFileSync(out, JSON.stringify(rules), "utf-8");
console.log(`✔ 已提取 ${rules.length} 条内置规则 → ${path.relative(process.cwd(), out)}`);
