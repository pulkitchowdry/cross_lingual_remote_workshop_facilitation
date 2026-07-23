import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { defineConfig, env } from "prisma/config";

// Next.js keeps local secrets in .env.local. Prisma's CLI is run separately,
// so load it explicitly, falling back to the conventional .env for CI.
if (existsSync(".env.local")) {
  loadEnvFile(".env.local");
} else if (existsSync(".env")) {
  loadEnvFile(".env");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
