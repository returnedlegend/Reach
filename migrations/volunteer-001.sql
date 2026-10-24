-- Additive volunteer schema; apply after shared community/account and pantry schemas.
CREATE TABLE IF NOT EXISTS volunteer_notice_limits(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,last_notified_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS volunteer_runs(
 id TEXT PRIMARY KEY,
 offer_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
 pantry_id TEXT NOT NULL REFERENCES pantries(id) ON DELETE CASCADE,
 donor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 volunteer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','open','assigned','completed','cancelled')),
 pickup_consent INTEGER NOT NULL DEFAULT 0 CHECK(pickup_consent IN (0,1)),
 revision INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 CHECK((status='assigned' AND volunteer_id IS NOT NULL AND pickup_consent=1) OR status!='assigned')
);
CREATE UNIQUE INDEX IF NOT EXISTS volunteer_one_active_offer ON volunteer_runs(offer_id) WHERE status IN ('pending','open','assigned');
CREATE UNIQUE INDEX IF NOT EXISTS volunteer_one_assignment ON volunteer_runs(volunteer_id) WHERE status='assigned';
CREATE INDEX IF NOT EXISTS volunteer_run_pantry ON volunteer_runs(pantry_id,status);
CREATE TRIGGER IF NOT EXISTS volunteer_user_deletion BEFORE DELETE ON users BEGIN
 UPDATE volunteer_runs SET status='open',volunteer_id=NULL,pickup_consent=0,revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE volunteer_id=OLD.id AND status='assigned';
 UPDATE volunteer_runs SET volunteer_id=NULL,pickup_consent=0 WHERE volunteer_id=OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS volunteer_offer_closed AFTER UPDATE OF status ON records WHEN NEW.status!='approved' BEGIN
 UPDATE volunteer_runs SET status='cancelled',pickup_consent=0,revision=revision+1,updated_at=NEW.updated_at WHERE offer_id=NEW.id AND status IN ('pending','open','assigned');
END;
CREATE TRIGGER IF NOT EXISTS volunteer_pantry_closed AFTER UPDATE OF active ON pantries WHEN NEW.active=0 BEGIN
 UPDATE volunteer_runs SET status='cancelled',pickup_consent=0,revision=revision+1,updated_at=NEW.updated_at WHERE pantry_id=NEW.id AND status IN ('pending','open','assigned');
END;
