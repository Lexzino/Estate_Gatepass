# EstateGate — secure QR visitor access for residential estates

One mobile app (Expo / React Native) with role-based login for **Residents**, **Security Guards** and **Estate Admins**, backed by a FastAPI service and MongoDB.

> **Stack note.** The original brief asked for Flutter + NestJS + PostgreSQL + Redis. This build environment runs Expo + FastAPI + MongoDB, so the system was delivered on that stack with the same security design (Ed25519-signed passes, Argon2id, rotating refresh tokens, field-level encryption, append-only audit log, encrypted offline cache). See "Production hardening" for the parts that are replaced by managed services in production.

## Layout
```
backend/            FastAPI service (OpenAPI at /api/docs)
  core.py           config, Fernet field encryption, HMAC PII hashes, Argon2id, Ed25519 signing, JWT, rate limiting, audit chain, log redaction
  passes.py         pure pass-validation rules (mirrored on the guard device)
  services.py       visits, guard responses, incidents, retention job
  routes_*.py       auth / resident / guard / admin / public
  seed.py           idempotent demo data + indexes
  tests/            unit + API + E2E tests (pytest)
frontend/           Expo app (expo-router)
  app/resident/*    dashboard, invite, pass (QR + share + revoke), alerts
  app/guard/*       scanner, full-screen result, lookup, walk-in approval, log
  app/admin/*       overview + traffic chart, people/devices, security (incidents, masked visits, audit), settings (retention)
  src/offline.ts    encrypted offline cache + queue, local Ed25519 verification
docs/               security checklist, DPIA + breach response
infra/.env.example  environment template
```

## Local setup
1. `cd backend && pip install -r requirements.txt` — MongoDB must be reachable via `MONGO_URL`.
2. Copy `infra/.env.example` → `backend/.env` and generate secrets (commands inside the template).
3. `uvicorn server:app --host 0.0.0.0 --port 8001` — indexes and seed data are created on start (`seed.py`). Raw seeded pass tokens are written to `/app/memory/seed_pass_tokens.md` (dev only).
4. `cd frontend && yarn && yarn start` — set `EXPO_PUBLIC_BACKEND_URL` to the API origin. Open in Expo Go or the web preview.
5. Tests: `cd backend && python -m pytest tests -q -n 0`.

"Migrations": MongoDB is schemaless; schema is enforced by Pydantic models on every request and by the unique/TTL indexes in `seed.ensure_indexes()`, which run idempotently on every start.

## Environment variables (backend)
| Name | Purpose |
|---|---|
| `MONGO_URL`, `DB_NAME` | database |
| `ACCESS_TOKEN_SECRET` / `REFRESH_TOKEN_SECRET` | separate secrets for JWT access tokens and refresh-token HMAC |
| `FIELD_ENCRYPTION_KEY` | Fernet (AES-128-CBC + HMAC) key for phones, emails, plates |
| `PII_HASH_KEY` | HMAC key for phone/email lookup hashes |
| `SIGNING_KEY_ID`, `SIGNING_KEY_SEED` | current Ed25519 pass-signing key |
| `SIGNING_KEYS_PREVIOUS` | `kid:seed,...` old keys kept for verification during rotation |
| `CORS_ORIGINS` | comma-separated allow-list |
| `APP_ENV` | `development` exposes the reset OTP in the response (no SMS provider yet) |
| `EMERGENT_PUSH_KEY` | push relay key (set automatically at deploy) |

## Demo accounts
| Role | Sign-in | Password |
|---|---|---|
| Admin | admin@estategate.ng | Admin@12345! |
| Resident (B12) | adaeze@estategate.ng | Resident@123! |
| Residents (A3, C7, D2, E9) | chinedu@ / funmi@ / ibrahim@ / ngozi@estategate.ng | Resident@123! |
| Guards | +2348020000001, +2348020000002 | Guard@12345! |

Estate code for self-registration: **LKG** (new residents stay *pending* until an admin approves them). Guards bind to the first device they sign in on; admins can revoke or reset the device.

## How offline QR validation works
1. On pass creation the API builds a compact payload `{v, ec (estate code), n (nonce), s (128-bit secret), f, t (window), k (key id)}` and signs it with Ed25519 → `EG1.<payload>.<signature>`. No names, phones, house numbers or DB ids are in the QR.
2. Only `sha256(token)` is stored. The resident sees the QR once (and can **reissue**, which rotates the hash and kills the old QR).
3. Guard devices call `GET /guard/offline-passes` on start, every 10 min and when connectivity returns. The response holds the public keys and, for passes valid in the next 24–72 h, only: token hash, visitor & host display name, house, window, max/current scans, type, gate restriction, schedule. It is stored encrypted with XChaCha20-Poly1305; the key lives in Keychain/Keystore.
4. Offline, the app verifies the signature locally, checks estate code, window, schedule, gate and scan count (server count + locally used), then shows the result.
5. Every offline scan/decision goes to an encrypted local queue. `POST /guard/scan/offline-sync` uploads it idempotently (`device_id + local_id`); admissions are consumed atomically and any admission that exceeds `max_scans` is recorded as **needs_review** + a `OFFLINE_DUPLICATE` incident for the admin.
6. Revoking a guard device ends its sessions; the device wipes its cache and queue on the next 401/403 (remote wipe).

## Security architecture (summary)
- **Auth:** Argon2id passwords (10+ chars, letter, number, symbol); 15-min HS256 access JWT; opaque rotating refresh tokens stored as HMAC hashes with family-wide revocation on reuse; per-request family + account + device checks; lockout after 5 failures; rate limits on login, refresh, reset, OTP, scan, lookup, sync.
- **Authorization:** `require_role` on every router; estate scoping for guards/admins; household scoping (`estate_id + house_number`) for residents; 404 for foreign ids (no IDOR oracle).
- **Data:** phone, email, plate, contact encrypted at field level; HMAC lookup hashes; admins see masked visit lists and must give a logged reason to reveal PII.
- **Audit:** append-only hash-chained `audit_logs` (`/admin/audit-logs/verify`); no update/delete endpoints.
- **Logs:** structured, with a redaction filter for tokens, bearer headers, phones and emails.
- **Transport/headers:** HSTS, nosniff, frame-deny, `no-store`; strict CORS allow-list.
- **Guard UI:** screenshot blocking on the result screen; identity confirmation required before admitting.

## Production hardening (to do before launch)
- Move signing seed + encryption keys to a KMS/secret manager (AWS KMS / GCP KMS / Vault) and rotate signing keys quarterly via `SIGNING_KEYS_PREVIOUS`.
- Replace the in-process rate limiter with Redis; add a job queue (e.g. Celery/RQ/Arq) for notifications, sync processing and retention.
- Connect an SMS/WhatsApp provider for OTP and pass delivery; set `APP_ENV=production`.
- MongoDB Atlas (or managed equivalent) with encryption at rest, automated encrypted backups, least-privilege DB users, and a write-only role for `audit_logs`.
- Certificate pinning and device-integrity checks (Play Integrity / App Attest) need a native build; add guard PIN/biometric unlock.
- CI: dependency scanning, secret scanning, SAST, then an external penetration test.
- Separate dev / staging / production projects and secrets.

## Deployment checklist
- [ ] HTTPS only (TLS ≥ 1.2), HSTS enabled at the edge
- [ ] All secrets in the secret manager, none in the repo or app bundle
- [ ] `APP_ENV=production`, `CORS_ORIGINS` restricted
- [ ] Backups + restore drill done
- [ ] Retention period confirmed per estate
- [ ] DPIA signed off; privacy notice published; breach runbook owner assigned
- [ ] Push: `google-services.json` in `frontend/`, publish + build
