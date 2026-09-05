import { Client } from "pg";
import fs from "node:fs/promises";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  throw new Error("请在 .env.local 中设置 DATABASE_URL，再运行 npm run db:init。");
}
const client = new Client({ connectionString, connectionTimeoutMillis: 5_000 });
try {
  await client.connect();
  await client.query(await fs.readFile(new URL("../postgres/schema.sql", import.meta.url), "utf8"));
  console.log("RouteX PostgreSQL 数据表已就绪，现有配置已保留。");
} finally {
  await client.end();
}
