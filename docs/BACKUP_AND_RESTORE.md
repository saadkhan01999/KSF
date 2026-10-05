# Backup and restore

**KSF Pharmacy Management System 2.0**

Two layers, and you want both:

| Layer | What it protects against | How |
|---|---|---|
| **Atlas Backup** (cloud snapshots, point-in-time restore) | Losing the cluster, a bad deployment, an accidental delete minutes ago | Atlas › your cluster › **Backup**. Available on M10 and above |
| **KSF backup file** | Losing the Atlas account, wanting a copy off the cloud, moving to another cluster, auditing a day's data | `npm run db:backup` |

---

## Taking a backup

```bash
npm run db:backup
```

On Windows: double-click `windows\BACKUP_KSF.bat`.

What happens:

1. Every collection in the database named by `MONGODB_DB` is read.
2. One file is written to `.data/backups` (or `BACKUP_DIR`):
   `ksf-ksf_pharmacy-2026-10-03T08-30-00-000Z.ndjson.gz`.
   The first line is a manifest — database, time, every collection and its
   document count. Each following line is one document in MongoDB Extended
   JSON, so dates, ids and numbers come back exactly as they went in.
3. A SHA-256 checksum is written beside it (`….ndjson.gz.sha256`).
4. The file is **read back and verified** straight away: the checksum, the
   manifest, and the document count of every collection.

A backup that has never been verified is a hope, not a backup — so this
command does not finish without checking.

### Every day, automatically

**Windows** — Task Scheduler › Create Basic Task › Daily, 23:30 ›
Start a program: `cmd.exe`, arguments
`/c cd /d D:\parmacy && npm run db:backup` (the `.bat` waits for a key
press at the end, so it is meant for double-clicking, not for scheduling).

**Linux** (crontab):

```cron
30 23 * * * cd /srv/ksf && npm run db:backup >> /var/log/ksf-backup.log 2>&1
```

**Docker**:

```bash
docker compose -f deploy/docker-compose.yml exec app node backend/dist/cli/backup.js
```

Then copy `.data/backups` somewhere else — another disk, a cloud drive — at
least weekly. A backup on the same disk as the database is not a backup.

---

## Verifying a backup file

```bash
npm run db:verify -- .data/backups/ksf-ksf_pharmacy-2026-10-03T08-30-00-000Z.ndjson.gz
```

Prints the manifest and either `ok` or the exact problem (checksum mismatch,
a collection with a missing document, a damaged line).

---

## Restoring

1. **Stop the server.** A till writing a sale half-way through a restore
   helps nobody.
2. Run, first without `--yes` — this only describes what it will do:

   ```bash
   npm run db:restore -- .data/backups/<file>.ndjson.gz
   ```

3. Read what it says (which backup, how many documents, which database will
   be replaced). Then:

   ```bash
   npm run db:restore -- .data/backups/<file>.ndjson.gz --yes
   ```

What happens:

1. The file is verified. A damaged file is refused before anything is
   touched.
2. **A fresh backup of the current data is taken first** — so a restore can
   itself be undone.
3. Each collection in the backup is emptied and refilled.
4. The indexes are rebuilt.

On Windows: `windows\RESTORE_KSF.bat` asks for the file and confirms.

Everyone has to sign in again afterwards (sessions are part of the data).

---

## Restoring an Atlas snapshot instead

Atlas › cluster › **Backup** › choose a snapshot › **Restore** › restore to
this cluster (or to a new one, then point `MONGODB_URI` at it). Point-in-time
restore lets you choose the minute — useful for "someone deleted a medicine
at 14:05".

---

## Starting again from empty (development only)

```bash
npm run db:reset -- --yes
```

Takes a backup, drops the database, and recreates the indexes, the plans and
the Super Admin from `.env`. Refuses to run with `NODE_ENV=production`
unless `--production` is also given.

---

## Before a data import

Each import in **Settings › Data migration** keeps its own record of what it
added, so the import itself can be rolled back from that screen. The import
rollback does not need a backup file; `npm run db:backup` before a large
first import is still sensible.
