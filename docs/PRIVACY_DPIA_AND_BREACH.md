# Privacy: NDPA 2023 compliance, DPIA outline and breach response

## Data inventory
| Data | Subject | Why | Stored as | Who can see |
|---|---|---|---|---|
| Name | visitor | identify at gate | plaintext | household, guard on duty, admin |
| Phone | visitor | lookup at gate, dedupe | encrypted + HMAC hash | household (masked), admin with reason |
| Vehicle plate (optional) | visitor | gate check | encrypted | household, guard (on ALLOW), admin with reason |
| Name, house, phone, email | resident | account + host display | phone/email encrypted | resident, admin (masked phone) |
| Scan events | visitor/guard | security record | ids only | household (own), guard (own 24 h), admin |

No National ID numbers or photos are collected.

## Lawful basis
Legitimate interest of the estate in securing its premises (NDPA s.25(1)(f)); residents also consent at registration. Visitors receive the privacy notice on the pass page (what, why, retention, who has access, how to exercise rights).

## Retention
Configurable per estate: 90 days, 6 months (default) or 12 months. A daily job deletes visits past the period, anonymises their scan events, deletes orphaned visitor records, old requests and notifications, and writes an audit entry. Admins can run it on demand.

## Data-subject rights
`POST /api/privacy/requests` (access / correction / deletion) → admin queue in Settings. Respond within the statutory timelines; log the outcome.

## DPIA outline (complete before launch)
1. Describe processing (above) and data flows (resident app → API → guard device cache).
2. Necessity & proportionality: minimal fields, short pass windows, masked admin views.
3. Risks: lost guard phone, insider browsing, token replay, data breach.
4. Mitigations: device binding + remote wipe, reason-logged PII reveal, signed one-time tokens, field encryption, audit chain.
5. Residual risk sign-off by the estate's Data Protection Officer.

## Breach response runbook
1. **Detect & contain (0–4 h):** revoke affected guard devices / sessions (`/admin/devices/:id/revoke`), rotate signing and encryption keys, block the vector.
2. **Assess (≤ 24 h):** scope from audit log (`/admin/audit-logs`, verify chain), identify subjects and data types.
3. **Notify:** the Nigeria Data Protection Commission within **72 hours** of awareness where the breach is likely to risk data subjects' rights; notify affected residents/visitors without undue delay when high risk.
4. **Recover & review:** restore from backup if needed, post-incident review, update DPIA and this runbook.
