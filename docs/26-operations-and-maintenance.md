# 26 — Operations and maintenance (handover for the IT Technician)

Status: **started 18 October 2026**, before the server exists. Fill in the blanks (`____`) as the server is set up. Keep this page true: when something changes on the server, change it here in the same week.

**Who:** the IT Technician. That's Terry Mosoma for now; this page is written so someone else can take over.

**Why it matters:** Humo runs its own sign-in, database and email on one VPS (D14, [doc 25](25-identity-and-hosting-options.md)). There's no cloud provider patching things for us. If a task here is skipped, nobody else will do it.

**Rule of thumb:**
- **Security updates:** within a week.
- **Critical security updates:** within 48 hours.
- **Restore test:** every month. A backup that has never been restored is a guess.

---

## 1. What's running (inventory)

| Component | Version | Supported until ⚠ | Where it's configured |
|---|---|---|---|
| **Server:** Webway VPS | ____ vCPU / ____ GB RAM / ____ GB SSD | Contract renewal: ____ | Webway client area |
| **OS:** Ubuntu Server LTS (recommended) | 24.04 LTS | Standard support until about May 2029 | `/etc/` on the server |
| **Docker Engine + Compose** | ____ | Rolling releases | `backend/deploy/docker-compose.yml` |
| **Caddy** (reverse proxy and HTTPS) | 2.x | Rolling releases | `backend/deploy/Caddyfile` |
| **.NET runtime** (ASP.NET Core 10, LTS) | 10.0.x | **10 November 2028** | API container image |
| **PostgreSQL** | 18.x (recommended at setup) | About November 2030 | Database container; data volume `____` |
| **Mail server:** Stalwart (or Postal) | ____ | Rolling releases | `backend/deploy/mail/` |
| **Frontend:** Angular SPA | Angular 22, built with Node 24 LTS | Node 24 until about April 2028. Each Angular major is supported for about 18 months. | `frontend/humo-web`; built in CI, served by Caddy |
| **Domain and DNS** | `humo.co.za`; the app at `pm.humo.co.za`; email from `notify.humo.co.za` | Domain renewal: ____ | Registrar or DNS host: ____ |
| **Object storage** (backups, files) | Webway S3-compatible storage | | Bucket names: ____ |
| **Uptime monitor** (off-server) | ____ | | ____ |

**When a "supported until" date is less than 6 months away,** plan the upgrade (§4).

## 2. Access and secrets

| What | Where it's kept | Who has it |
|---|---|---|
| Webway client area login | Password manager: ____ | ____ |
| SSH keys for the server (no password login) | Each person's own key; public keys in `~/.ssh/authorized_keys` | ____ |
| Registrar and DNS login | Password manager | ____ |
| PostgreSQL passwords | `.env` on the server (never in git); copy in the password manager | ____ |
| Backup encryption key | Password manager **and** a sealed offline copy | ____ |
| ASP.NET Core Data Protection keys (§3) | Database or a persisted volume; included in backups | |
| Mail DKIM private key | Mail server data volume; included in backups | |
| Mail settings (`Mail__*`: host, port, security, account) | `.env` on the server; see doc 25 §2 *Mail settings* | |
| SMS provider settings (`Sms__Provider`, `Sms__Providers__<Name>__*`) | `.env` on the server; see `backend/README.md` | |
| Sealed recovery envelope (§8) | ____ (a safe or a trusted person) | |

**Rules:**
- Secrets never go in git, in chat, or in email.
- When someone leaves:
  - remove their SSH key and password-manager access the same day;
  - rotate any secret they could read.
- Use two-factor authentication on the Webway, registrar and GitHub accounts.

## 3. Things specific to running our own sign-in

**Data Protection keys.**
- ASP.NET Core uses these to encrypt sign-in cookies and one-time codes.
- **They must be persisted and backed up.** If they're lost, everyone is signed out and outstanding codes stop working. Nothing is leaked, but it's disruptive.

**Passkey domain (relying-party ID): `pm.humo.co.za`.**
- **Never change it.** Every passkey is bound to it; changing it forces every user to register again.

**Rate limits** on sign-in, code requests and step-up: check them monthly in the logs (§5).

**Patching .NET is security work:**
- the sign-in code is part of the API;
- a .NET security fix **is** a sign-in fix.

**The audit log is append-only.**
- Never delete or edit rows, even to "clean up".
- Retention: ____ (decide with the POPIA policy).

## 4. Maintenance schedule

### Weekly (about 15 minutes)
- [ ] OS security updates. `unattended-upgrades` installs these automatically; check that it ran (`/var/log/unattended-upgrades/`) and reboot if `/var/run/reboot-required` exists.
- [ ] Check last night's backup arrived in object storage, at the expected size.
- [ ] Check disk space (`df -h`): alert above 80%.
- [ ] Glance at the uptime monitor and the error log.

### Monthly (about 1–2 hours)
- [ ] **.NET patch.** Microsoft releases on the second Tuesday ("Patch Tuesday").
  1. Update the base image tag.
  2. Rebuild.
  3. Run the tests.
  4. Deploy.
- [ ] **Container images:** pull and redeploy Caddy, PostgreSQL (minor versions only) and the mail server.
- [ ] **Restore test:** restore last night's backup into a scratch database and run a sanity query (§6).
- [ ] **Email health:**
  - blacklist check for the server IP (e.g. MXToolbox);
  - Google Postmaster Tools;
  - Microsoft SNDS;
  - DMARC reports.
- [ ] **Frontend dependencies:**
  - `npm audit` in `frontend/humo-web`;
  - fix high and critical findings;
  - CI must stay green.
- [ ] **Backend dependencies:** `dotnet list package --vulnerable`.
- [ ] **Security review:**
  - failed SSH logins (`fail2ban` status);
  - sign-in rate-limit hits;
  - unusual audit entries.
- [ ] Add an entry to the maintenance log (§10).

### Quarterly
- [ ] **Firewall review** (`ufw status`). Only 22 (SSH), 80, 443 and the mail ports should be open.
- [ ] **Access review:**
  - who has SSH keys, Webway access and GitHub access;
  - who holds System Administrator in Humo PM.
- [ ] **Capacity:** CPU, RAM, disk and database size trends. Upgrade the VPS before it's above 70% sustained.
- [ ] **Full disaster-recovery rehearsal:** build a fresh server from this page and the latest backup (§7). Time it. Fix this page where it was wrong.
- [ ] Check the "supported until" column (§1).

### Yearly
- [ ] **Major upgrades,** planned in a quiet week. Back up first, and test on a copy first.
  - **.NET:** move to the next LTS before the current one ends. .NET 10 → .NET 12 by November 2028.
  - **PostgreSQL major version:** dump and restore, or `pg_upgrade`.
  - **Ubuntu LTS:** every 2 years, or rebuild on the new LTS.
  - **Angular:** keep within the supported majors.
- [ ] Rotate:
  - the backup encryption key;
  - database passwords;
  - DKIM keys.
- [ ] Renew the domain and the Webway contract. Check auto-renew and payment details.
- [ ] Update the POPIA documents:
  - privacy policy;
  - record of processing;
  - Webway operator agreement.
- [ ] Re-read this whole page and fix what's out of date.

### Automatic (check that it still works)
- **HTTPS certificates:** Caddy renews them about 30 days before expiry. Check the expiry date monthly; the uptime monitor should also alert on it.
- **OS security updates:** `unattended-upgrades`.
- **Nightly database backup:** a cron job or a container (§6).
- **Webway daily VM backups** ⚠: a second safety net, not the main backup.

## 5. Monitoring and alerts

| What | How | Alert when |
|---|---|---|
| Site and API up | An off-server uptime monitor (a free external service, or a small second VPS running Uptime Kuma) checking `https://pm.humo.co.za/` and `https://pm.humo.co.za/api/health` | Down for more than 2 minutes |
| HTTPS certificate | The same monitor | Fewer than 14 days left |
| Disk space | A script or the monitor's agent | Above 80% |
| Backups | The backup job emails or pings on success; the monitor alerts when no ping arrives | No success in 26 hours |
| Errors | API logs (`docker compose logs api`) | A rise in 5xx errors |
| Email | Mail-server queue and bounce rate | Queue stuck, or bounces above 5% |

**Alerts go to:** ____ (email or phone). They must not depend on our own mail server.

## 6. Backups and restore

**What is backed up:**
1. **PostgreSQL:**
   - a nightly `pg_dump` (custom format);
   - compressed and encrypted;
   - uploaded to object storage.
   - **Keep:** 14 daily, 8 weekly and 12 monthly copies.
2. **Data volumes:** Data Protection keys, the mail server (DKIM keys, configuration), uploaded files if they're not already in object storage, and the `.env` file (encrypted).
3. **Configuration:** everything else is in git (`backend/deploy/`).

**Restore test (monthly):**
1. Download last night's dump.
2. Restore it into a scratch database: `pg_restore -d humo_restore_test ...`.
3. Run `SELECT count(*)` on organisations, identities and audit entries. Compare with production.
4. Drop the scratch database.
5. Record the result in the maintenance log.

**Second copy:** consider a second copy with another South African provider. It's encrypted, so a failure at Webway can't take both.

## 7. Rebuilding the server from nothing

Write the exact commands here during the first setup. **Target: back up within 4 hours.**

1. Order a VPS, or reinstall the existing one, with Ubuntu LTS.
2. **Harden the server:**
   - create the admin user and add SSH keys;
   - turn off password and root SSH login;
   - set up `ufw` and `fail2ban`;
   - set up `unattended-upgrades`.
3. Install Docker.
4. Clone the repository, then restore `.env` from the password manager.
5. Restore the data volumes and the latest database dump (§6).
6. `docker compose up -d`. Caddy fetches certificates.
7. **If the IP changed:** update DNS (A records, SPF, PTR via Webway).
8. **Check:**
   - sign in with a passkey;
   - `GET /api/me`;
   - send a test email;
   - check the audit log.

## 8. Incidents

| Problem | First steps |
|---|---|
| **Site down** | 1. Check the uptime monitor and Webway's status page.<br>2. `docker compose ps` and `docker compose logs --tail 200`.<br>3. Restart the failed service.<br>4. Check disk space. |
| **Database corrupt or data lost** | 1. Stop the API.<br>2. Restore the latest good backup (§6).<br>3. Record what was lost and for how long. |
| **Certificate expired** | 1. `docker compose logs caddy`.<br>2. Check DNS and that port 80 is open.<br>3. Restart Caddy. |
| **Sign-in codes going to spam** | 1. Check the blacklists and DMARC reports.<br>2. Switch on the fallback relay (doc 25 §2).<br>3. Fix the reputation, then switch the relay off. |
| **Suspected breach** (strange logins, unknown SSH keys, data leaving) | 1. Isolate the server (Webway console, firewall).<br>2. Preserve the logs.<br>3. Rotate every secret.<br>4. Rebuild from a known-good backup.<br>5. **POPIA s22:** notify the Information Regulator and the affected people as soon as reasonably possible.<br>6. Write it up. |
| **Sole System Administrator lost every passkey** | Open the sealed recovery envelope. It holds the documented procedure and a one-time recovery secret. Use it to issue a one-time sign-in to the administrator's verified email, then register a new passkey. Audit it, then seal a new envelope. Making a second System Administrator removes most of this risk (doc 16). |

## 9. Deploying a new version

1. Merge to `main`; CI must be green.
2. Back up the database (on demand, not only nightly).
3. On the server:
   - `git pull`;
   - `docker compose build` (or pull the CI image);
   - `docker compose up -d`.
   - Database migrations run when the API starts (`Database__Initialise=Migrate`), which is why step 2 comes first.
4. **Smoke test:**
   - sign in;
   - open a scheme;
   - check `/api/health`.
5. **If it's broken:**
   1. redeploy the previous image tag;
   2. restore the pre-deploy backup only if a migration damaged data.

## 10. Maintenance log

Keep a running log here or in `docs/ops-log.md`: date, what was done, by whom, and anything odd.

| Date | Who | What | Notes |
|---|---|---|---|
| ____ | | Server set up | |

## Related

- [25-identity-and-hosting-options.md](25-identity-and-hosting-options.md): what was chosen and why.
- [17-decisions.md](17-decisions.md): D14.
- [16-humo-team.md](16-humo-team.md): System Administrators and the sole-administrator safeguard.
- [18-production-readiness-register.md](18-production-readiness-register.md): R-5 (delivery results), R-8 (sign-in), R-11 (files).
