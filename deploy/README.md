# Deploying KSF

**KSF Pharmacy Management System 2.0**

The production stack is three containers, defined in `docker-compose.yml`:

| Service | What it is |
|---|---|
| `app` | The compiled API (Node 22, non-root, read-only file system), which also serves the built website |
| `web` | Nginx 1.27: HTTPS, HTTP/2, HSTS, rate limits on sign-in, compression |
| `mongo` | *Optional* (profile `local-db`): a one-node MongoDB 7 replica set reachable only by `app`. With MongoDB Atlas — recommended — leave it off |

Nothing secret is built into the image; every credential comes from
`deploy/.env` at run time.

---

## 1. A server

Any Linux server with Docker Engine 24+ and the Compose plugin. 2 vCPU and
2 GB RAM is plenty for dozens of pharmacies (the database lives on Atlas).
Open ports 80 and 443 only.

```bash
git clone <your repository> /srv/ksf
```

```bash
cd /srv/ksf
```

## 2. Settings

```bash
cp .env.example deploy/.env
```

Edit `deploy/.env` (`docs/ENVIRONMENT.md` explains every line). For
production these must be set:

```ini
NODE_ENV=production
COOKIE_SECURE=true
PUBLIC_APP_URL=https://pharmacy.example.pk
PUBLIC_ALLOWED_ORIGINS=https://pharmacy.example.pk

MONGODB_URI="mongodb+srv://ksf_app:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority"
MONGODB_DB=ksf_pharmacy

JWT_ACCESS_SECRET=<48 random bytes>
JWT_REFRESH_SECRET=<a different 48 random bytes>

SUPER_ADMIN_EMAIL=you@yourcompany.pk
SUPER_ADMIN_PASSWORD="<a strong password>"

MAIL_TRANSPORT=smtp
MAIL_HOST=smtp.example.com
MAIL_USER=...
MAIL_PASSWORD="..."
```

Generate the two JWT secrets (they must differ):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

In Atlas › Network Access, allow the server's public IP.

`TRUST_PROXY` and `COOKIE_SECURE` are already set for the container in
`docker-compose.yml`.

## 3. HTTPS

Nginx will not start without a certificate. Start with a self-signed one:

```bash
mkdir -p deploy/nginx/certs
```

```bash
openssl req -x509 -nodes -days 3650 -newkey rsa:2048 -keyout deploy/nginx/certs/ksf.key -out deploy/nginx/certs/ksf.crt -subj "/CN=ksf.local"
```

That is enough for a private network. For a public domain, once the stack
is running (step 4) and the domain's DNS points at the server, issue a
Let's Encrypt certificate through the challenge folder Nginx already serves:

```bash
docker run --rm -v ksf-pharmacy_certbot-www:/var/www/certbot -v /etc/letsencrypt:/etc/letsencrypt certbot/certbot certonly --webroot -w /var/www/certbot -d pharmacy.example.pk
```

```bash
cp /etc/letsencrypt/live/pharmacy.example.pk/fullchain.pem deploy/nginx/certs/ksf.crt
```

```bash
cp /etc/letsencrypt/live/pharmacy.example.pk/privkey.pem deploy/nginx/certs/ksf.key
```

```bash
docker compose -f deploy/docker-compose.yml exec web nginx -s reload
```

Renewal: run the same `certbot … renew` container monthly from cron, copy
the two files again, reload Nginx.

## 4. Start

With MongoDB Atlas:

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
```

With the bundled MongoDB instead (set
`MONGODB_URI="mongodb://mongo:27017/?replicaSet=rs0"` in `deploy/.env`):

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml --profile local-db up -d --build
```

The image build type-checks and compiles everything; a type error stops it.
On the first start the app creates the indexes, the plans and the Super
Admin. Check:

```bash
docker compose -f deploy/docker-compose.yml logs app --tail 30
```

```bash
curl -fsS https://pharmacy.example.pk/api/v1/health
```

Sign in as the Super Admin, then immediately change the e-mail and password
in **My account** and switch on two-step sign-in.

## 5. Updating

```bash
git pull
```

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
```

Indexes are created idempotently on every start; there are no migration
steps to run by hand. Take a backup first (below).

## 6. Backups

```bash
docker compose -f deploy/docker-compose.yml exec app node backend/dist/cli/backup.js
```

The file lands in the `ksfdata` volume under `/app/.data/backups`. Copy it
off the server:

```bash
docker compose -f deploy/docker-compose.yml cp app:/app/.data/backups ./backups
```

With Atlas, switch on cluster backups too. `docs/BACKUP_AND_RESTORE.md` has
restores and scheduling.

## 7. Operating

| Task | Command |
|---|---|
| Logs | `docker compose -f deploy/docker-compose.yml logs -f app` |
| Restart | `docker compose -f deploy/docker-compose.yml restart app` |
| Database check | `docker compose -f deploy/docker-compose.yml exec app node backend/dist/cli/check-database.js` |
| Sign everybody out | Generate new JWT secrets in `deploy/.env`, then `up -d` |
| Health | `GET /api/v1/health` — used by the container health check |

## Without Docker

Any host with Node.js 20+:

```bash
npm ci
```

```bash
npm run build
```

```bash
NODE_ENV=production npm start
```

Run it under a process manager (systemd, PM2, or Windows Task Scheduler at
start-up) behind any reverse proxy that terminates TLS; set `TRUST_PROXY`
to the proxy's address.

---

## Files here

| File | Purpose |
|---|---|
| `docker-compose.yml` | The three services, volumes and private network |
| `docker/Dockerfile` | Two-stage build: compile and type-check, then a small runtime image |
| `nginx/nginx.conf` | Global Nginx settings, rate-limit zones, compression |
| `nginx/ksf.conf` | The site: HTTP → HTTPS, TLS, security headers, proxy to `app` |
