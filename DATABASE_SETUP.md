# Database setup — MongoDB

**KSF Pharmacy Management System 2.0**

KSF keeps everything in one **MongoDB** database: pharmacies, their staff,
stock, sales, subscriptions, payments, referrals and support requests. This
guide takes you from nothing to a running system, one numbered step at a time.

Pick **one** path:

| Path | Use it when | Time |
|---|---|---|
| [**A. MongoDB Atlas** (cloud)](#2-path-a--mongodb-atlas-recommended) | Recommended for almost everyone, including production. Free tier to start; backups and security handled for you. | ~15 minutes |
| [**B. MongoDB on a Windows computer**](#3-path-b--mongodb-on-a-windows-computer) | You want the database on your own machine (development, or an office server). | ~20 minutes |
| [**C. MongoDB in Docker**](#4-path-c--mongodb-in-docker) | You deploy with the bundled `docker-compose.yml`. | ~5 minutes |

Then everybody continues with [first start](#5-first-start-and-the-super-admin).

---

## 1. Before you start

1. Install **Node.js 20 or newer** (the LTS installer from nodejs.org). Check:

   ```bash
   node --version
   ```

2. In the project folder, install the packages once:

   ```bash
   npm install
   ```

3. The project already contains a **`.env`** file. This is the only file you
   edit. It holds three things that matter:

   | Setting | What it is |
   |---|---|
   | `MONGODB_URI` | Your database's connection string — **you paste this in** |
   | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | The keys that sign every sign-in. Already generated |
   | `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD` | The platform owner's first sign-in. Already filled in — change them if you like before the first start |

> **Why a replica set?** KSF saves a sale, its stock movements and its payment
> in one *transaction* — all of it or none of it. MongoDB offers transactions
> on a replica set. Atlas is always one; on your own computer it is one extra
> line in a settings file (Path B, step 4).

---

## 2. Path A — MongoDB Atlas (recommended)

### Step 1 — Create the cluster

1. Go to **mongodb.com/cloud/atlas** and sign up (or sign in).
2. Create a **project**, e.g. *KSF Pharmacy*.
3. Click **Create** a cluster. Choose **M0 (Free)** to start, or **M10+**
   for production. Pick the region closest to your users — for Pakistan,
   *Mumbai (ap-south-1)* or *Bahrain (me-south-1)*.
4. Wait a minute or two until the cluster shows as ready.

### Step 2 — Create a database user

1. Left menu: **Security › Database Access › Add New Database User**.
2. Method: **Password**. Username, e.g. `ksf_app`.
3. Click **Autogenerate Secure Password** and **copy it somewhere safe**.
4. Role: **Read and write to any database** (or, stricter, `readWrite` on the
   database `ksf_pharmacy` only).
5. **Add User**.

### Step 3 — Allow your computer or server to connect

1. Left menu: **Security › Network Access › Add IP Address**.
2. On your own computer: **Add Current IP Address**.
   On a server: enter the server's public IP.
3. **Confirm**.

> `0.0.0.0/0` (allow from anywhere) works for a quick test, but do not leave
> it like that in production.

### Step 4 — Copy the connection string

1. Go back to **Database** (Clusters) and click **Connect** on your cluster.
2. Choose **Drivers**, driver **Node.js**.
3. Copy the string. It looks like this:

   ```
   mongodb+srv://ksf_app:<db_password>@cluster0.ab1cd.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
   ```

4. Replace `<db_password>` (including the `<` `>`) with the password from
   step 2.

### Step 5 — Paste it into `.env`

Open `.env` in the project folder and find:

```ini
MONGODB_URI="PASTE-YOUR-MONGODB-CONNECTION-STRING-HERE"
```

Replace the text between the quotes with your string, keeping the quotes:

```ini
MONGODB_URI="mongodb+srv://ksf_app:Xy7pQ2mN9vT4@cluster0.ab1cd.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"
MONGODB_DB=ksf_pharmacy
```

`MONGODB_DB` is the database name KSF uses inside the cluster. Atlas creates
it on the first start — you do not create it yourself.

**If your password contains special characters**, they must be written in
"URL-encoded" form inside the connection string:

| Character | Write it as |
|---|---|
| `@` | `%40` |
| `:` | `%3A` |
| `/` | `%2F` |
| `?` | `%3F` |
| `#` | `%23` |
| `%` | `%25` |

Example: password `Ab@12#cd` becomes `Ab%4012%23cd`. Easier still: let Atlas
autogenerate a password, which uses letters and digits only.

Now go to [**5. First start**](#5-first-start-and-the-super-admin).

---

## 3. Path B — MongoDB on a Windows computer

### Step 1 — Install MongoDB

1. Download **MongoDB Community Server** (version 7.0 or newer, *msi*
   package) from mongodb.com/try/download/community.
2. Run the installer: **Complete**, and leave **Install MongoD as a Service**
   ticked.
3. Also install **MongoDB Shell (mongosh)** from
   mongodb.com/try/download/shell. You need it once, in step 4.

### Step 2 — Turn it into a one-computer replica set

1. Open Notepad **as Administrator** and open the settings file:

   ```
   C:\Program Files\MongoDB\Server\7.0\bin\mongod.cfg
   ```

   (Use the version number you installed.)

2. Find the line `#replication:` and replace it with these two lines — the
   indent before `replSetName` is two spaces:

   ```yaml
   replication:
     replSetName: rs0
   ```

3. Save.

### Step 3 — Restart the MongoDB service

Open **Command Prompt as Administrator** and run:

```bat
net stop MongoDB
```

```bat
net start MongoDB
```

### Step 4 — Start the replica set (once only)

In a normal Command Prompt:

```bat
mongosh --eval "rs.initiate()"
```

You should see `ok: 1`. Check with:

```bat
mongosh --eval "rs.status().ok"
```

It prints `1`.

### Step 5 — Paste the connection string into `.env`

```ini
MONGODB_URI="mongodb://127.0.0.1:27017/?replicaSet=rs0"
MONGODB_DB=ksf_pharmacy
```

> Running MongoDB **without** the replica set also works — KSF detects it and
> falls back to careful step-by-step writes — but `npm run db:check` will warn
> you, and a crash in the middle of a sale is better handled with
> transactions. Use the replica set.

Now go to [**5. First start**](#5-first-start-and-the-super-admin).

---

## 4. Path C — MongoDB in Docker

`deploy/docker-compose.yml` contains an optional MongoDB 7 service (a
one-node replica set that only the app can reach). Start everything with the
`local-db` profile:

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml --profile local-db up -d
```

and in `deploy/.env`:

```ini
MONGODB_URI="mongodb://mongo:27017/?replicaSet=rs0"
```

The replica set initialises itself on the first start. `deploy/README.md`
covers the rest of a Docker deployment.

---

## 5. First start and the Super Admin

### Step 1 — Check the connection

```bash
npm run db:check
```

Every line should start with `ok`:

```
KSF database check — MongoDB (cluster0.ab1cd.mongodb.net/ksf_pharmacy)

  ok  Connected to MongoDB 7.0.x
  ok  Transactions available (replica set or Atlas)
```

On a brand-new database it then says the database is empty — that is
expected: the first start creates everything. Run it again after step 2 and
it lists the plans, the Super Admin and every collection.

### Step 2 — Start KSF

```bash
npm run dev
```

On Windows you can double-click **`windows\START_KSF.bat`** instead.

On its first start the server creates, in this order: the indexes, the four
subscription plans (Basic, Weekly, Monthly, Annual) and **the Super
Admin** from `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD`. The console says:

```
[KSF] added 4 subscription plan(s)
[KSF] created the platform Super Admin account for superadmin@ksfpharmacy.pk
```

### Step 3 — Sign in

The browser opens by itself (usually `http://localhost:5180`). Click
**Sign in** and use the Super Admin e-mail and password from `.env`.

### Step 4 — Change the Super Admin's e-mail and password

Click your name (top right) › **My account**:

- **Profile** — change your name and **e-mail address**.
- **Password** — enter the current password, then the new one twice.

From now on the account lives in the database. `.env` is read for the Super
Admin **only once**, when no Super Admin exists — changing it later does
nothing. (To recover a forgotten Super Admin password, use **Forgot password**
on the sign-in page; the reset code is e-mailed.)

### Step 5 — The first pharmacy

Pharmacies register themselves: the website's **Start free trial** button.
The person who registers becomes that pharmacy's **Admin**. The Super Admin
sees the new pharmacy at once under **Pharmacies**.

In development, e-mails (sign-up codes, password resets) are not sent: they
are printed in the server console and saved in `.data/outbox`. Set
`MAIL_TRANSPORT=smtp` and the `MAIL_*` settings to send them for real
(`docs/ENVIRONMENT.md`).

---

## 6. Backups

```bash
npm run db:backup
```

writes one compressed file to `.data/backups` (with a SHA-256 checksum
beside it) and immediately reads it back to prove it can be restored. On
Windows: `windows\BACKUP_KSF.bat`. On Atlas, also switch on the cluster's own
**Backup** (paid tiers) — that is your first line of defence; the file is the
copy you keep yourself.

To restore (stop the server first):

```bash
npm run db:restore -- .data/backups/<file>.ndjson.gz --yes
```

The current data is backed up automatically before anything is replaced.
`docs/BACKUP_AND_RESTORE.md` has the details.

---

## 7. Troubleshooting

| What you see | What it means and what to do |
|---|---|
| `MONGODB_URI is empty` / `must start with mongodb://` | The connection string is not pasted in `.env`, or the quotes are missing. See §2 step 5. |
| `bad auth : authentication failed` | Wrong username or password in the string — or a special character not URL-encoded (§2 step 5). Reset the user's password in Atlas › Database Access if unsure. |
| `Could not connect … ETIMEDOUT` / `Server selection timed out` | Atlas is refusing your IP. Add it under Network Access (§2 step 3). On office networks, port 27017 outbound may be blocked. |
| `querySrv ENOTFOUND` | DNS could not resolve the `mongodb+srv` address. Check the cluster name; try another network; or use the *standard* (non-srv) string from Atlas. |
| `Transactions NOT available — a single standalone server` in `db:check` | Local MongoDB without a replica set. Do §3 steps 2–4. |
| `No Super Admin yet` in the console | `SUPER_ADMIN_EMAIL` or `SUPER_ADMIN_PASSWORD` is empty in `.env`. Fill them in and restart. |
| `SUPER_ADMIN_PASSWORD in .env is not strong enough` | Use at least 12 characters with upper and lower case, a digit and a symbol. Keep the quotes. |
| `JWT_ACCESS_SECRET must be at least 32 characters` | Run `npm run secrets -- --write`. |
| Signed out immediately after signing in | In production, `COOKIE_SECURE=true` needs HTTPS, and `PUBLIC_APP_URL` must match the address in the browser exactly. |

---

## 8. Security checklist for a live database

- [ ] A dedicated database user for KSF, with `readWrite` on `ksf_pharmacy` only.
- [ ] Network Access lists only your server's IP — no `0.0.0.0/0`.
- [ ] Atlas Backup switched on (M10+), and `npm run db:backup` scheduled daily.
- [ ] `.env` is never committed, e-mailed or pasted into a chat.
- [ ] New JWT secrets generated for production (`npm run secrets -- --write`).
- [ ] The Super Admin's e-mail and password changed from **My account**, and
      two-step sign-in switched on under **Security Centre**.
- [ ] `NODE_ENV=production`, `COOKIE_SECURE=true`, HTTPS in front.

---

Created by **Saad Bin Saeed Khan** — Software Engineer — MPhil/MS Scholar.
