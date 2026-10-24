-- Executed transactionally by openPantryDatabase after account schema migration.
-- Runtime source of truth is pantryMigration1 in src/lib/pantry-store.ts.
BEGIN IMMEDIATE;

CREATE TABLE pantries(id TEXT PRIMARY KEY,name TEXT NOT NULL,address TEXT NOT NULL,resource_json TEXT NOT NULL CHECK(json_valid(resource_json)),planner_json TEXT NOT NULL CHECK(json_valid(planner_json)),active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),website TEXT,last_verified TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX pantry_directory ON pantries(active,name,id);
CREATE TABLE pantry_hours(pantry_id TEXT NOT NULL REFERENCES pantries(id) ON DELETE CASCADE,window_id TEXT NOT NULL,position INTEGER NOT NULL,window_json TEXT NOT NULL CHECK(json_valid(window_json)),PRIMARY KEY(pantry_id,window_id));
CREATE TABLE pantry_closures(pantry_id TEXT NOT NULL REFERENCES pantries(id) ON DELETE CASCADE,date TEXT NOT NULL,PRIMARY KEY(pantry_id,date));
CREATE TABLE pantry_inventory(pantry_id TEXT NOT NULL REFERENCES pantries(id) ON DELETE CASCADE,category TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('available','limited','unavailable','unknown')),quantity INTEGER CHECK(quantity IS NULL OR quantity>=0),source TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(pantry_id,category));
CREATE TABLE pantry_managers(pantry_id TEXT NOT NULL REFERENCES pantries(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,created_at TEXT NOT NULL,PRIMARY KEY(pantry_id,user_id));
CREATE INDEX pantry_manager_user ON pantry_managers(user_id,pantry_id);
CREATE TABLE pantry_favorites(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,pantry_id TEXT NOT NULL REFERENCES pantries(id) ON DELETE CASCADE,created_at TEXT NOT NULL,PRIMARY KEY(user_id,pantry_id));
CREATE TABLE pantry_corrections(id TEXT PRIMARY KEY,pantry_id TEXT NOT NULL REFERENCES pantries(id),submitted_by TEXT REFERENCES users(id) ON DELETE SET NULL,description TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),created_at TEXT NOT NULL,reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,reviewed_at TEXT,notes TEXT);
CREATE INDEX pantry_correction_queue ON pantry_corrections(status,created_at,id);
CREATE TABLE pantry_history(id INTEGER PRIMARY KEY AUTOINCREMENT,pantry_id TEXT NOT NULL REFERENCES pantries(id),version INTEGER NOT NULL,action TEXT NOT NULL,actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),created_at TEXT NOT NULL,UNIQUE(pantry_id,version));
CREATE INDEX pantry_history_listing ON pantry_history(pantry_id,created_at);
CREATE TABLE pantry_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,action TEXT NOT NULL,pantry_id TEXT REFERENCES pantries(id),details_json TEXT NOT NULL CHECK(json_valid(details_json)),created_at TEXT NOT NULL);
CREATE INDEX pantry_audit_recent ON pantry_audit(created_at,id);

CREATE TABLE IF NOT EXISTS pantry_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
INSERT INTO pantry_migrations VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
COMMIT;
