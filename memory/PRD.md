# EstateGate — PRD

## Original problem statement
Production-ready, secure QR-code visitor access system for residential estates (Nigeria): residents pre-authorize visitors; guards scan QR passes (online + offline) and see ALLOW / DENY / EXPIRED / REVOKED / ALREADY USED / NEEDS REVIEW; admins manage estates, residents, guards, gates, devices, rules, audit logs, retention. Strong security (signed tokens, hashed tokens, Argon2id, rotating refresh tokens, RBAC, isolation, encryption, audit), NDPA 2023 privacy, tests, docs, seed data.

## User choices
- One Expo app with role-based login (platform can't build Flutter/NestJS/Postgres; delivered on Expo + FastAPI + MongoDB)
- Passes shared via the phone share sheet
- Phone push notifications (Emergent push relay) + in-app alerts list
- Offline guard scanning with sync

## Architecture
- Backend: FastAPI (`core.py`, `passes.py`, `services.py`, `routes_auth/resident/guard/admin/public.py`, `seed.py`, `push.py`), MongoDB, OpenAPI at `/api/docs`
- Frontend: expo-router; `app/resident/*`, `app/guard/*`, `app/admin/*`; `src/offline.ts` (Ed25519 verify, XChaCha20 encrypted cache/queue), `src/guard.tsx`, `src/auth.tsx`, `src/api.ts`
- Docs: `/app/README.md`, `/app/docs/SECURITY_CHECKLIST.md`, `/app/docs/PRIVACY_DPIA_AND_BREACH.md`, `/app/infra/.env.example`

## Implemented (2026-10-30)
- Auth: register (pending → admin approve), login (email/phone), Argon2id, 15-min JWT, rotating refresh + reuse detection, logout, OTP reset (dev OTP shown — SMS MOCKED), lockout, rate limits, guard device binding/revoke/reset + remote wipe
- Resident: dashboard, invite (one-time / date range / recurring / contractor), QR pass + share + revoke + reissue, filters, alerts, approve/reject gate requests, push registration
- Guard: camera scanner, gate selector, online/offline pill + pending count, full-screen result with identity confirmation, manual lookup (phone/ref/pasted code), walk-in approval flow, gate log with exit logging, offline cache + queue sync, duplicate flagging, screenshot blocking
- Admin: overview metrics + 7-day traffic chart, residents/guards/gates management, device revoke/reset with reason, incidents, masked visits + reason-logged reveal, hash-chained audit log + verify, retention settings + run, privacy requests
- Seed: 1 estate, 5 residents, 10 visitors, 2 guards, 2 gates, admin, sample one-time / recurring / contractor / expired / revoked / used passes
- Tests: 53 pytest tests (unit + API + E2E), all passing
- Fixes after testing: visitor name stored per visit, audit append concurrency, atomic request claim, stale lookup/alerts

## Backlog
- P0: google-services.json for Android push (user said they'd attach it; not received yet), then publish + build
- P1: SMS/WhatsApp provider for OTP & pass delivery; guard PIN/biometric unlock; Redis rate limiting + job queue; KMS for keys
- P2: certificate pinning & device integrity (native build), visitor photo (optional), CSV exports, multi-estate switcher for admins
