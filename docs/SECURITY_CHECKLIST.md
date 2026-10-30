# EstateGate security checklist

## Authentication
- [x] Argon2id hashing (argon2-cffi defaults), strong-password rule enforced server side
- [x] 15-minute access JWT, fixed algorithm, issuer/audience/required claims checked
- [x] Opaque refresh tokens, stored as HMAC hashes, rotated on every use
- [x] Refresh reuse → whole token family revoked + audit event
- [x] Separate access and refresh secrets
- [x] Lockout after 5 failed logins (15 min) + per-IP and per-identifier rate limits
- [x] Logout / password reset / suspension revoke sessions immediately (family check on every request)
- [x] Individual guard accounts, device binding, remote revoke/reset
- [ ] Guard PIN / biometric unlock (planned)
- [ ] OTP delivery over SMS (currently dev-mode display only)

## QR pass security
- [x] Ed25519 signatures (`cryptography`), no custom crypto
- [x] QR contains estate code, nonce, 128-bit random secret, window, key id — no PII or DB ids
- [x] Only SHA-256 of the token stored; QR shown once, reissue rotates it
- [x] Unique nonce per pass (unique index on token hash and reference)
- [x] One-time passes consumed atomically (conditional update); race → needs_review incident
- [x] Default windows: one-time ≤ 24 h, date range ≤ 7 d, contractor ≤ 30 d, recurring ≤ 90 d
- [x] Instant revocation; revoked passes drop out of the offline list
- [x] Scan, lookup and sync endpoints rate limited
- [x] Incidents for invalid-token bursts (TOKEN_GUESSING), duplicate, expired and revoked attempts
- [x] Key rotation supported (`SIGNING_KEYS_PREVIOUS`); private key never leaves the server
- [ ] Private key in KMS/HSM (production)

## Offline mode
- [x] Minimal cache (hash, display names, house, window, counts, gates, schedule)
- [x] Encrypted at rest on device (XChaCha20-Poly1305, key in Keychain/Keystore)
- [x] Local signature verification with public key only
- [x] Encrypted queue, idempotent upload, duplicate admissions flagged for admin review
- [x] Remote wipe on device revocation

## Encryption & data
- [x] Field-level encryption of phones, emails, plates, privacy-request contacts
- [x] HMAC-hashed phone/email for lookup
- [x] Admin PII reveal requires a reason and is audited
- [ ] Managed DB encryption at rest + encrypted backups (production)

## Authorization
- [x] Role check on every endpoint; estate scoping; household scoping; uniform 404 for foreign ids
- [x] Pydantic strict models (`extra=forbid`, patterns, lengths) on every input; Mongo queries built from typed values only

## Logging & monitoring
- [x] Structured logs with redaction (tokens, bearer, phones, emails)
- [x] Hash-chained append-only audit log with verification endpoint
- [ ] Central log shipping + alerting on incidents (production)

## Mobile
- [x] Tokens in Keychain/Keystore via expo-secure-store
- [x] Screenshot blocking on guard result screen
- [ ] Certificate pinning, device integrity checks (needs native build)

## Backups & incident response
- [ ] Daily encrypted backups, 30-day retention, quarterly restore test
- [x] Breach runbook: see `PRIVACY_DPIA_AND_BREACH.md`
- [ ] Dependency, secret and static scanning in CI; external pen test before launch
