import fs from "node:fs";
import path from "node:path";

const root = path.resolve("D:/Projects/English-Listening-Lab/apps/server");

function writeSchema(sourceName, targetDir, output, urlName, directName, comment) {
  const source = fs.readFileSync(path.join(root, sourceName), "utf8");
  const body = source.replace(/^[\s\S]*?^model /m, "model ");
  const schema = `${comment}

generator client {
  provider = "prisma-client-js"
  output   = "${output}"
}

datasource db {
  provider  = "postgresql"
  url       = env("${urlName}")
  directUrl = env("${directName}")
}

${body}`;
  fs.mkdirSync(path.join(root, targetDir), { recursive: true });
  fs.writeFileSync(path.join(root, targetDir, "schema.prisma"), schema);
}

writeSchema(
  "prisma-user/schema.prisma",
  "prisma-neon-user",
  "../src/generated/neon-user",
  "NEON_USER_DATABASE_URL",
  "NEON_USER_DIRECT_URL",
  `// PostgreSQL multi-user tables for Neon schema lab_phase_h only.
// This client must not replace the SQLite clients or migrate public.`,
);
writeSchema(
  "prisma-auth/schema.prisma",
  "prisma-neon-auth",
  "../src/generated/neon-auth",
  "NEON_AUTH_DATABASE_URL",
  "NEON_AUTH_DIRECT_URL",
  `// Better Auth tables for Neon schema lab_phase_h_auth only.
// Do not copy real auth.db accounts into this schema.`,
);
console.log("schemas written");
