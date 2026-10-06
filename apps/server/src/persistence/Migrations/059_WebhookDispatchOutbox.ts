import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE scheduled_task_webhook_dispatches (
    delivery_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    task_created_at TEXT NOT NULL,
    prompt TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    run_counted INTEGER NOT NULL DEFAULT 0
  )`;
  yield* sql`CREATE INDEX idx_webhook_dispatches_task ON scheduled_task_webhook_dispatches(task_id)`;
  // Only refs and their consumer identities are recorded here, never values.
  yield* sql`CREATE TABLE consumed_secret_request_refs (
    secret_ref TEXT PRIMARY KEY,
    consumer_id TEXT,
    consumed_at INTEGER NOT NULL
  )`;
  yield* sql`CREATE INDEX idx_consumed_secret_refs_at ON consumed_secret_request_refs(consumed_at)`;
});
