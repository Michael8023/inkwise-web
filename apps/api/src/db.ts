import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
export const database = connectionString ? new Pool({ connectionString }) : null;

export function requireDatabase() {
  if (!database) throw new Error("DATABASE_NOT_CONFIGURED");
  return database;
}
