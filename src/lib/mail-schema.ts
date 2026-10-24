import type { DatabaseSync } from "node:sqlite";

function deliveryTable(name: string) {
  return `CREATE TABLE ${name}(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE SET NULL,kind TEXT NOT NULL,provider TEXT NOT NULL,provider_message_id TEXT,rfc_message_id TEXT,status TEXT NOT NULL CHECK(status IN ('pending','accepted','preview','uncertain','failed','delayed','held','delivered','bounced')),error_code TEXT,attempts INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,event_at REAL)`;
}

/** Preserve existing mail history and outbox IDs while adopting opaque string IDs. */
export function initializeMailSchema(db: DatabaseSync): void {
  db.exec("SAVEPOINT reach_mail_schema");
  try {
    const columns = db.prepare("PRAGMA table_info(mail_deliveries)").all();
    if (!columns.length) db.exec(deliveryTable("mail_deliveries"));
    else if (
      columns.find((column) => column.name === "provider_message_id")?.type !==
      "TEXT"
    ) {
      db.exec(deliveryTable("mail_deliveries_upgrade"));
      db.exec(`INSERT INTO mail_deliveries_upgrade SELECT id,user_id,kind,provider,CAST(provider_message_id AS TEXT),rfc_message_id,status,error_code,attempts,created_at,updated_at,event_at FROM mail_deliveries;
        DROP TABLE mail_deliveries;
        ALTER TABLE mail_deliveries_upgrade RENAME TO mail_deliveries;`);
    }
    // The old index name is removed without touching historical provider rows.
    db.exec(`DROP INDEX IF EXISTS postal_message_id;
      CREATE UNIQUE INDEX IF NOT EXISTS mail_provider_message_id ON mail_deliveries(provider,provider_message_id) WHERE provider_message_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS mail_webhook_events(uuid TEXT PRIMARY KEY,received_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mail_rate_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at INTEGER NOT NULL);
      RELEASE reach_mail_schema;`);
  } catch (error) {
    db.exec("ROLLBACK TO reach_mail_schema; RELEASE reach_mail_schema");
    throw error;
  }
}
