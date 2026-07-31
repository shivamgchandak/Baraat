/** Applies sql/rls.sql to the database pointed at by DIRECT_URL/DATABASE_URL. */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "rls.sql"), "utf8");

// Split on statement boundaries that end with ';' at line end.
// $$-quoted function bodies are handled by grouping.
const statements: string[] = [];
let buf = "";
let inDollar = false;
for (const line of sql.split("\n")) {
  const stripped = line.replace(/--.*$/, "");
  const dollarCount = (stripped.match(/\$\$/g) ?? []).length;
  if (dollarCount % 2 === 1) inDollar = !inDollar;
  buf += line + "\n";
  if (!inDollar && stripped.trimEnd().endsWith(";")) {
    if (buf.trim()) statements.push(buf);
    buf = "";
  }
}

for (const stmt of statements) {
  await prisma.$executeRawUnsafe(stmt);
}
console.log(`Applied ${statements.length} RLS statements.`);
await prisma.$disconnect();
