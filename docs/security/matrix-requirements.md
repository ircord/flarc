# FlaRC: Comprehensive Authorization, Security and Data Integrity Test Matrix

## Mission

This is an additional testing requirement for the security audit already in progress.

Continue your existing work. Do not abandon current findings, remediation, or tests.

I want FlaRC tested as a hostile, multi-user environment where clients deliberately try to perform operations they should not be permitted to perform.

The goal is to prove:

1. Network administrators can perform legitimate administrative operations.
2. Ordinary users cannot perform administrative operations.
3. Channel administrators can manage channels within their assigned permissions.
4. Channel operators cannot exceed their channel privileges.
5. Ordinary users cannot modify other users' accounts, messages, permissions, sessions or private data.
6. Users cannot access channels, conversations, history or events they are not authorized to access.
7. All permissions are enforced consistently through IRC, REST, WebSocket events, NickServ, ChanServ, F and other applicable interfaces.
8. Revoking permissions actually removes access from existing sessions.
9. Unauthorized operations produce no unauthorized database modifications, event deliveries or other side effects.
10. Legitimate operations actually persist correctly and produce the expected state changes.

**Implement executable tests, not merely documentation or a checklist.**

Use this document to expand the existing test suites substantially.

---

## 1. Test infrastructure and identities

Create isolated, deterministic test fixtures with genuinely independent accounts, credentials, authenticated sessions and channel memberships.

### Test accounts

Use at least these identities:

| Account | Role |
|---|---|
| `rootadmin` | Network administrator |
| `ircop` | Network IRC operator |
| `alice` | Ordinary registered user |
| `bob` | Ordinary registered user |
| `charlie` | Ordinary registered user |
| `founder` | Channel founder |
| `chanadmin` | Channel administrator (+a) |
| `operator` | Channel operator (+o) |
| `halfop` | Channel half-operator (+h) |
| `voiced` | Voiced user (+v) |
| `banned` | User banned from a channel |
| `disabled` | Disabled account |
| `servicebot` | Authenticated bot/service account |
| `anonymous` | Unauthenticated client |
| `expired` | User with expired/revoked credentials |

Do not implement these as fake authorization flags passed into a function.

Create actual accounts and authenticate through FlaRC's real authentication mechanisms.

### Test channels

Create at least these:

| Channel | Configuration |
|---|---|
| `#public` | Public, normal channel |
| `#secret` | Secret (+s) |
| `#private` | Private, if supported (+p) |
| `#invite` | Invite-only (+i) |
| `#moderated` | Moderated (+m) |
| `#locked` | Key-protected (+k) |
| `#restricted` | Registered-channel access policy |
| `#staff` | Restricted staff channel |
| `#roles` | Custom role groups and permissions |
| `#readonly` | Announcements/read-only |
| `#history` | Messages from multiple time periods |
| `#empty` | Registered channel without active members |

Assign different owners, operators, ordinary members and banned users to each.

Ensure Alice has elevated privileges in one channel but none in another.

### Test conversations

Create:

- Alice ↔ Bob DM.
- Bob ↔ Charlie DM.
- Alice ↔ Charlie DM.
- Group DM containing Alice, Bob and Charlie, if supported.
- Group DM excluding Alice, if supported.

Populate conversations with unique messages whose contents can be identified in assertions.

### Test transport variants

Where an operation is exposed through multiple interfaces, test the same operation through:

- IRC/IRCv3 commands.
- REST API.
- Real-time events/WebSocket.
- Service-bot commands.
- Legacy API aliases.
- Administrative interfaces.

Generate relevant authorization cases programmatically instead of hand-writing thousands of nearly identical tests.

---

## 2. Universal security assertions

Every security test should verify more than a response status.

### For an authorized operation

Assert that:

- The operation succeeds.
- The correct resource is modified.
- Persistent database state matches the requested change.
- Unrelated resources remain unchanged.
- Authorized recipients receive appropriate events.
- Unauthorized recipients receive nothing.
- The change survives an independent read and runtime restart where applicable.

### For an unauthorized operation

Assert that:

- The operation is rejected.
- An appropriate error is returned.
- No protected data is returned.
- No database modification occurs.
- No permission or membership change occurs.
- No unauthorized event is emitted.
- No protected information leaks through error messages.
- The rejected operation cannot succeed through another transport.

Use consistent `401`, `403` and `404` semantics as appropriate, including avoiding resource-existence disclosure where necessary.

Do not consider a test passed simply because the handler returned `403` if it already modified the database before rejecting the request.

---

# 3. Authentication tests

Implement the following scenarios.

- AUTH-001: Unauthenticated IRC clients cannot send channel messages.
- AUTH-002: Unauthenticated IRC clients cannot send DMs.
- AUTH-003: Unauthenticated clients cannot JOIN channels.
- AUTH-004: NICK and USER alone do not authenticate a session.
- AUTH-005: Valid account credentials authenticate successfully.
- AUTH-006: Invalid passwords are rejected.
- AUTH-007: Unknown accounts are rejected.
- AUTH-008: Disabled accounts cannot authenticate.
- AUTH-009: Deleted accounts cannot authenticate.
- AUTH-010: Expired sessions cannot access REST APIs.
- AUTH-011: Revoked sessions cannot access REST APIs.
- AUTH-012: Incorrect credentials never create a usable session.
- AUTH-013: Successful login resolves the correct stable account identity.
- AUTH-014: NickServ and REST authentication resolve the same account.
- AUTH-015: SASL authentication resolves the same account.
- AUTH-016: Authentication restores legitimate account-based ChanServ permissions.
- AUTH-017: Authentication does not automatically confer channel privileges the account doesn't possess.
- AUTH-018: Ordinary account creation cannot assign administrator privileges.
- AUTH-019: User-controlled registration properties cannot inject privileged roles.
- AUTH-020: Account signup restrictions are enforced.
- AUTH-021: Multiple failed logins trigger appropriate rate limits.
- AUTH-022: Logging out invalidates the relevant session.
- AUTH-023: Password reset invalidates sessions according to the defined security policy.
- AUTH-024: Account disable revokes active access.
- AUTH-025: Reenabling an account does not silently reactivate previously revoked sessions.
- AUTH-026: Authentication credentials do not appear in public API responses or logs.
- AUTH-027: Malformed SASL and SCRAM exchanges fail safely.
- AUTH-028: SCRAM authentication matches published cryptographic test vectors.
- AUTH-029: Unknown users and invalid passwords do not expose unnecessary account-enumeration information.
- AUTH-030: Pre-authentication IRC commands are limited to the permitted authentication and registration flow.

Also test that authentication works when the same account has multiple active devices.

---

# 4. Network administrator authorization

Test both successful administrator operations and rejection of the same operations from ordinary users.

### Administrator operations

- ADMIN-001: Administrator can list accounts.
- ADMIN-002: Administrator can inspect permitted account administration metadata.
- ADMIN-003: Administrator can disable an account.
- ADMIN-004: Administrator can reenable an account.
- ADMIN-005: Administrator can revoke a session.
- ADMIN-006: Administrator can disconnect an active IRC user.
- ADMIN-007: Administrator can assign network roles within their authority.
- ADMIN-008: Administrator can remove network roles.
- ADMIN-009: Administrator can register a channel administratively.
- ADMIN-010: Administrator can inspect channel configuration.
- ADMIN-011: Administrator can change network-controlled channel settings.
- ADMIN-012: Administrator can apply global bans.
- ADMIN-013: Administrator can remove global bans.
- ADMIN-014: Administrator can broadcast network notices.
- ADMIN-015: Administrator can inspect operational statistics.
- ADMIN-016: Administrator can inspect appropriate administrative audit logs.
- ADMIN-017: Administrator can manage service-bot configuration.
- ADMIN-018: Administrator can revoke compromised bot credentials.

### Forbidden operations

Repeat every relevant administrator operation as Alice, Bob, an ordinary channel operator, a channel founder without network privileges, an unauthenticated client and a revoked session.

Assert rejection.

Specifically:

- ADMIN-019: Ordinary users cannot enumerate all accounts through admin APIs.
- ADMIN-020: Ordinary users cannot disable other accounts.
- ADMIN-021: Ordinary users cannot reset other users' passwords.
- ADMIN-022: Ordinary users cannot assign network-wide roles.
- ADMIN-023: Ordinary users cannot revoke other users' sessions.
- ADMIN-024: Ordinary users cannot issue network-wide announcements.
- ADMIN-025: Channel founders cannot impersonate network administrators.
- ADMIN-026: IRC operators cannot perform network-administrator-only actions unless explicitly delegated.
- ADMIN-027: Administrators cannot exceed their configured privilege scope.
- ADMIN-028: No administrator API can be accessed through an unprotected legacy alias.
- ADMIN-029: Administrative requests are audited with actor, action, target and outcome.
- ADMIN-030: Rejected administrative attempts do not modify state.

**Important:** Network administration is not automatically permission to silently impersonate users or read private conversations. Define and test any exceptional moderation or legal-access capabilities explicitly rather than granting unrestricted access by accident.

---

# 5. Account ownership and profile security

- USER-001: Alice can view her own profile.
- USER-002: Alice can update permitted fields on her own profile.
- USER-003: Alice cannot modify Bob's profile.
- USER-004: Alice cannot change Bob's avatar.
- USER-005: Alice cannot change Bob's display name.
- USER-006: Alice cannot change Bob's status.
- USER-007: Alice cannot change Bob's password.
- USER-008: Alice cannot change Bob's email or recovery credentials, if supported.
- USER-009: Alice cannot retrieve Bob's password hashes or SCRAM credential material.
- USER-010: Alice cannot add herself to another user's registered nicknames.
- USER-011: Alice cannot remove Bob's registered nickname.
- USER-012: Alice cannot set her own `isAdmin` or equivalent field.
- USER-013: Alice cannot assign herself a privileged account role.
- USER-014: Mass-assignment attempts using additional JSON properties are rejected or safely ignored.
- USER-015: Public profile endpoints do not expose private account metadata.
- USER-016: Profile updates propagate correctly to subscribed IRC clients.
- USER-017: Profile updates propagate correctly to authorized REST/event clients.
- USER-018: Private profile metadata is excluded from public metadata synchronization.
- USER-019: Disabled accounts cannot update profiles using existing sessions.
- USER-020: Account deletion follows the documented data-retention policy without deleting unrelated data.

Test URL ID substitution and request-body ID substitution separately.

---

# 6. Channel membership and access

### Public channels

- CHAN-001: Authenticated users can join ordinary public channels.
- CHAN-002: Joined users can send messages when permitted.
- CHAN-003: Users can leave a channel.
- CHAN-004: Leaving removes active membership.
- CHAN-005: Users cannot impersonate another member when joining.
- CHAN-006: Membership is restored or reconciled correctly after reconnects according to policy.

### Secret and private channels

- CHAN-007: Unauthorized users cannot discover secret channels through LIST.
- CHAN-008: Unauthorized users cannot discover secret channels through REST discovery.
- CHAN-009: Unauthorized users cannot enumerate secret-channel members.
- CHAN-010: Unauthorized users cannot retrieve secret-channel history.
- CHAN-011: Unauthorized users cannot subscribe to secret-channel events.
- CHAN-012: Unauthorized users cannot retrieve secret-channel attachment metadata.
- CHAN-013: Authorized members can access permitted secret-channel resources.
- CHAN-014: Revoked members lose future access.
- CHAN-015: History access before joining and after leaving follows an explicit documented policy.

### Invite-only and key-protected channels

- CHAN-016: Uninvited users cannot join invite-only channels.
- CHAN-017: Invitations grant only the intended access.
- CHAN-018: Invitations cannot be forged by ordinary members.
- CHAN-019: Revoked invitations cannot be reused.
- CHAN-020: Incorrect channel keys are rejected.
- CHAN-021: Channel keys are not exposed through unauthorized APIs or events.
- CHAN-022: REST and IRC enforce identical JOIN policies.
- CHAN-023: API-created membership cannot bypass invite/key restrictions.
- CHAN-024: Expired or consumed invitations cannot be replayed when applicable.

### Bans and restrictions

- CHAN-025: Banned users cannot rejoin.
- CHAN-026: Banned users cannot bypass restrictions using REST.
- CHAN-027: Banned users cannot publish messages through the API.
- CHAN-028: Banned users cannot receive restricted real-time events.
- CHAN-029: Ban exceptions work only when their defined conditions match.
- CHAN-030: Bans remain effective after disconnect/reconnect.
- CHAN-031: Nickname changes do not bypass account-based restrictions.
- CHAN-032: Membership data does not remain incorrectly authorized after a KICK.
- CHAN-033: Channel removal and re-registration do not accidentally retain stale permissions.

---

# 7. Channel roles and privilege hierarchy

Use a channel containing founder, administrator, operator, half-operator, voiced user and ordinary member.

### Founder and administrator

- ROLE-001: Founder can manage channel settings.
- ROLE-002: Founder can create permitted role groups.
- ROLE-003: Founder can assign roles within the policy.
- ROLE-004: Founder can remove roles.
- ROLE-005: Founder can configure the F service bot.
- ROLE-006: Founder can transfer ownership only through the authorized ownership-transfer flow.
- ROLE-007: Another user cannot impersonate the founder.
- ROLE-008: Channel administrators can perform their explicitly assigned moderation actions.
- ROLE-009: Channel administrators cannot assign privileges above their own.
- ROLE-010: Channel administrators cannot take ownership without authorization.

### Operators and half-operators

- ROLE-011: Operators can kick users when permitted.
- ROLE-012: Operators can ban users when permitted.
- ROLE-013: Operators can change permitted channel modes.
- ROLE-014: Operators cannot perform founder-only actions.
- ROLE-015: Half-operators cannot modify higher-ranked users when prohibited by the configured hierarchy.
- ROLE-016: Half-operators cannot assign operator privileges unless explicitly authorized.
- ROLE-017: Operators in `#public` have no automatic privileges in `#staff`.

### Voice and ordinary members

- ROLE-018: Voiced users can speak in moderated channels.
- ROLE-019: Ordinary users cannot speak in moderated channels unless independently permitted.
- ROLE-020: Voiced users cannot kick or ban members.
- ROLE-021: Ordinary users cannot change channel modes.
- ROLE-022: Ordinary users cannot change channel roles.
- ROLE-023: Ordinary users cannot modify restricted channel metadata.
- ROLE-024: Ordinary users cannot assign themselves voice through the REST API.

### Custom roles

- ROLE-025: Custom role names do not automatically grant privileges.
- ROLE-026: Custom permissions are applied consistently.
- ROLE-027: Removing a role immediately removes its associated permissions.
- ROLE-028: Custom permissions cannot escalate beyond the assigning actor's authority.
- ROLE-029: Deleting a role removes or safely reconciles assignments.
- ROLE-030: Role assignments survive restarts.
- ROLE-031: Role changes update IRC prefix modes where applicable.
- ROLE-032: IRC mode changes update API-visible role state where applicable.
- ROLE-033: Role changes invalidate cached permissions.
- ROLE-034: Role inheritance cannot create privilege-escalation cycles.
- ROLE-035: A malicious user cannot grant themselves access by creating a similarly named role.
- ROLE-036: Cross-channel role IDs cannot be reused to modify unrelated channels.

---

# 8. Messaging authorization

- MSG-001: Alice can send messages to a public channel she is authorized to use.
- MSG-002: Alice cannot send into a restricted channel she cannot access.
- MSG-003: Alice cannot forge Bob's sender identity.
- MSG-004: Alice cannot forge a server/service prefix.
- MSG-005: Alice cannot forge privileged server-generated account or role tags.
- MSG-006: Alice can edit her own message when editing is permitted.
- MSG-007: Alice cannot edit Bob's message.
- MSG-008: Alice cannot edit messages in inaccessible channels.
- MSG-009: Alice cannot use another channel's message ID to edit a different message.
- MSG-010: Editing produces correct persistent state.
- MSG-011: Editing produces correct authorized real-time events.
- MSG-012: Editing survives object reactivation.
- MSG-013: Unauthorized edits produce no data changes or events.
- MSG-014: Alice can redact her own message when policy permits.
- MSG-015: Alice cannot redact Bob's message without moderation privileges.
- MSG-016: Authorized moderators can redact messages according to policy.
- MSG-017: Moderation does not silently rewrite a message as though its author edited it.
- MSG-018: Redacted messages do not reappear through CHATHISTORY.
- MSG-019: Redacted messages do not reappear through REST history.
- MSG-020: Reply references cannot expose restricted messages.
- MSG-021: Reactions, if supported, respect channel access.
- MSG-022: Editing or deleting nonexistent messages produces a safe error.
- MSG-023: Duplicate message IDs cannot overwrite unrelated messages.
- MSG-024: Message ordering and sequence IDs remain correct under concurrent delivery.
- MSG-025: Failed message persistence does not result in a falsely confirmed durable message.
- MSG-026: Valid messages survive actual storage reinitialization.
- MSG-027: Messages from unauthorized or disabled accounts are rejected even when the socket remains open.
- MSG-028: IRC, REST and event clients receive the same canonical message identity and state.

---

# 9. Direct-message privacy

These are high-priority confidentiality tests.

Create distinct conversations for Alice/Bob, Bob/Charlie and Alice/Charlie.

- DM-001: Alice can send a DM to Bob when allowed.
- DM-002: Bob can read the Alice/Bob conversation.
- DM-003: Alice can read the Alice/Bob conversation.
- DM-004: Charlie cannot read Alice/Bob history.
- DM-005: Charlie cannot retrieve an Alice/Bob message by ID.
- DM-006: Charlie cannot modify an Alice/Bob message.
- DM-007: Charlie cannot delete an Alice/Bob message.
- DM-008: Charlie cannot subscribe to Alice/Bob events.
- DM-009: Charlie cannot retrieve Alice/Bob unread counts.
- DM-010: Charlie cannot enumerate Alice/Bob private attachments.
- DM-011: Alice cannot retrieve Bob/Charlie history.
- DM-012: Alice cannot substitute Bob's account ID to access Bob/Charlie history.
- DM-013: Conversation IDs cannot be manipulated to gain unauthorized access.
- DM-014: DM permissions are checked against the authenticated account, not supplied usernames.
- DM-015: A revoked session loses DM access.
- DM-016: Offline DM persistence preserves the correct recipient identity.
- DM-017: DM history survives restart and remains access-controlled afterward.
- DM-018: DM notifications go only to intended recipients.
- DM-019: DM API and IRC PRIVMSG paths apply consistent access policies.
- DM-020: No DM content appears in ordinary public-channel event streams.
- DM-021: Network administrators do not automatically gain private conversation access unless an explicit, documented administrative policy grants it.
- DM-022: No legacy API endpoint bypasses DM participant checks.
- DM-023: Group-DM membership changes revoke future access according to a clearly defined history policy, if group DMs are supported.
- DM-024: Server-side search cannot reveal other users' DMs.

Test direct access by conversation ID, message ID, sender ID and recipient ID independently.

---

# 10. REST API and legacy route security

Discover every actual route rather than testing only routes listed in documentation.

- API-001: Protected API without credentials is rejected.
- API-002: Invalid credentials are rejected.
- API-003: Expired credentials are rejected.
- API-004: Revoked credentials are rejected.
- API-005: Ordinary users cannot invoke admin endpoints.
- API-006: Changing the HTTP method cannot bypass authorization.
- API-007: Legacy route aliases enforce the same authorization as `/api/v1`.
- API-008: Username path parameters cannot impersonate another account.
- API-009: Channel path parameters cannot bypass membership checks.
- API-010: Query parameters cannot override authenticated identity.
- API-011: Request-body IDs cannot override authenticated identity.
- API-012: Privileged fields cannot be modified through mass assignment.
- API-013: Invalid input is rejected by runtime validation.
- API-014: Error responses do not leak database internals, credentials or stack traces.
- API-015: Unauthorized pagination cannot enumerate protected records.
- API-016: Bulk operations enforce authorization for every target resource.
- API-017: OpenAPI-described security requirements match actual route behavior.
- API-018: Undocumented routes do not accidentally bypass authentication.
- API-019: Cookie-based mutations enforce CSRF protection.
- API-020: Cross-origin requests follow the configured CORS policy.
- API-021: Admin credentials are not accepted through URL query strings.
- API-022: API responses exclude password hashes, secret keys and private internal attributes.
- API-023: Restricted responses have appropriate cache-control headers.
- API-024: Public documentation/health endpoints expose no operational secrets.

Generate cases from the actual Nitro route inventory and OpenAPI specification.

---

# 11. WebSocket and real-time event authorization

- WS-001: Unauthenticated event subscriptions are rejected.
- WS-002: Valid short-lived tickets establish authorized sessions.
- WS-003: Expired tickets are rejected.
- WS-004: Already-consumed tickets are rejected.
- WS-005: Concurrent attempts cannot redeem the same ticket twice.
- WS-006: Tickets for one endpoint cannot authenticate another endpoint.
- WS-007: Tickets cannot be redeemed as another account.
- WS-008: Reusable account credentials are not stored in WebSocket attachments.
- WS-009: Alice receives public events she is authorized to observe.
- WS-010: Alice cannot subscribe to `#staff` without permission.
- WS-011: Charlie cannot subscribe to Alice/Bob DM events.
- WS-012: Revoking channel access prevents future event delivery.
- WS-013: Disabling an account invalidates active event streams.
- WS-014: Session revocation continues to work after Durable Object hibernation.
- WS-015: Reconstructed attachments do not restore stale administrator privileges.
- WS-016: Reconnection cannot bypass authentication.
- WS-017: Event replay does not expose data outside the current access policy.
- WS-018: Event cursors cannot be used to retrieve another user's private events.
- WS-019: Cross-shard delivery respects channel subscription authorization.
- WS-020: Disconnects clean up subscription state.
- WS-021: Slow clients cannot exhaust unbounded buffers.
- WS-022: Duplicate event delivery does not result in unauthorized duplicate mutations.
- WS-023: WebSocket Origin checks and authentication policy are enforced.
- WS-024: Permission changes while the socket is idle take effect without requiring a user to reconnect voluntarily.

Test both a continuously active socket and one whose Durable Object has been reinitialized.

---

# 12. NickServ, ChanServ, F and other services

- SVC-001: Unauthenticated users cannot use privileged service commands.
- SVC-002: Users cannot authenticate as another account with invalid credentials.
- SVC-003: Users cannot register another user's nickname.
- SVC-004: Channel registration requires the defined permissions and prerequisites.
- SVC-005: Ordinary members cannot request founder privileges from F.
- SVC-006: F OP respects channel access lists.
- SVC-007: F DEOP respects hierarchy restrictions.
- SVC-008: F VOICE and DEVOICE respect assigned privileges.
- SVC-009: F CHANLEV cannot assign permissions exceeding the actor's authority.
- SVC-010: F cannot be used to bypass REST authorization.
- SVC-011: REST cannot be used to bypass service-bot authorization.
- SVC-012: ChanServ access assignments persist across reconnects.
- SVC-013: Removing ChanServ access revokes effective privileges.
- SVC-014: Unregistered channels do not receive unauthorized service-bot privileges.
- SVC-015: Service-bot identities cannot be spoofed by ordinary IRC clients.
- SVC-016: Service actions produce the correct audit events.
- SVC-017: A user with privileges in one channel cannot use them in another.

---

# 13. Media and attachment authorization

- MEDIA-001: Authenticated users can upload within configured limits.
- MEDIA-002: Unauthenticated users cannot upload.
- MEDIA-003: Users cannot delete attachments owned by others without permission.
- MEDIA-004: Private channel attachments are inaccessible to unauthorized users.
- MEDIA-005: DM attachments are inaccessible to nonparticipants.
- MEDIA-006: Guessing media IDs does not bypass authorization.
- MEDIA-007: Signed access links, where used, expire correctly.
- MEDIA-008: Private media is not inadvertently served from public immutable caches.
- MEDIA-009: File-size limits are enforced.
- MEDIA-010: Malicious filenames are safely handled.
- MEDIA-011: Dangerous content types cannot execute as trusted application content.
- MEDIA-012: Users cannot bypass storage quotas.
- MEDIA-013: Deleting an attachment updates persistent metadata correctly.
- MEDIA-014: Expired or removed resources cannot be retrieved through legacy URLs.
- MEDIA-015: Unauthorized users cannot enumerate private upload metadata.

Include R2 and local storage-provider tests where applicable.

---

# 14. WebPush and notification security

- PUSH-001: Users can register their own push subscriptions.
- PUSH-002: Users cannot register subscriptions under another account.
- PUSH-003: Users cannot list another user's private push endpoints.
- PUSH-004: Users cannot delete another user's subscriptions.
- PUSH-005: Disabled accounts cannot use old subscriptions to regain access.
- PUSH-006: Revoked subscriptions stop receiving notifications.
- PUSH-007: Private notifications are delivered only to intended accounts.
- PUSH-008: No private message bodies leak into unrelated notifications.
- PUSH-009: Notification preferences are enforced.
- PUSH-010: Invalid or expired push subscriptions are handled safely.
- PUSH-011: Repeated delivery failures do not cause unbounded retries.
- PUSH-012: WebPush credentials and subscription secrets do not appear in logs or public APIs.

---

# 15. Database and persistence integrity

The goal here is to prove that real operations work, not that mocks return expected values.

- DB-001: Account creation writes complete, valid database records.
- DB-002: Account login reads the correct persisted credentials.
- DB-003: Account updates survive runtime restart.
- DB-004: Account disable state survives runtime restart.
- DB-005: Channel registration persists.
- DB-006: Channel metadata updates persist.
- DB-007: Role assignments persist.
- DB-008: Removing roles updates related records correctly.
- DB-009: Message history persists.
- DB-010: Message edits persist.
- DB-011: Redactions persist and do not restore removed content unexpectedly.
- DB-012: Read markers persist.
- DB-013: Foreign-key constraints actually reject invalid references within one database.
- DB-014: Unique constraints reject duplicate records.
- DB-015: Transactions roll back incomplete modifications where appropriate.
- DB-016: Cross-Durable-Object failures do not produce unauthorized permanent state.
- DB-017: Concurrent changes preserve required invariants.
- DB-018: Ninety-day retention removes expired messages.
- DB-019: Retention cleanup does not remove unexpired messages.
- DB-020: Old database migrations preserve existing data.
- DB-021: Deleted accounts do not accidentally cascade-delete unrelated channel history.
- DB-022: Drizzle models match the actual deployed SQLite schema.
- DB-023: Repeated migrations are safe and idempotent where required.
- DB-024: Retry after a successful commit does not create duplicate messages or permissions.
- DB-025: A denied operation leaves stored data unchanged.
- DB-026: A new Durable Object instance cannot assume an unrelated object's database identity.
- DB-027: Query pagination cannot escape the intended account/channel scope.
- DB-028: SQL indexes support bounded history and authorization queries without full-table scans under representative load.

---

# 16. Input abuse and resource exhaustion

- ABUSE-001: Oversized IRC messages are rejected or handled according to protocol rules.
- ABUSE-002: Oversized WebSocket frames cannot exhaust memory.
- ABUSE-003: Oversized HTTP bodies are rejected.
- ABUSE-004: Authentication requests are rate-limited.
- ABUSE-005: Channel JOIN/PART flooding is controlled.
- ABUSE-006: Channel creation flooding is controlled.
- ABUSE-007: Excessive media uploads are controlled.
- ABUSE-008: History query limits cannot be bypassed using negative or extreme parameters.
- ABUSE-009: Invalid Unicode and malformed IRC tags cannot crash the server.
- ABUSE-010: User-controlled metadata cannot inject unauthorized server message tags.
- ABUSE-011: Excessive event subscriptions cannot exhaust memory.
- ABUSE-012: Slow consumers are disconnected or throttled safely.
- ABUSE-013: Repeated failing RPCs cannot trigger unbounded retry loops.
- ABUSE-014: Malformed API payloads cannot bypass Zod validation.
- ABUSE-015: Concurrent nickname claims result in only one authorized owner.
- ABUSE-016: Concurrent ticket redemption has only one winner.
- ABUSE-017: Untrusted embed URLs cannot trigger SSRF to private network or cloud metadata endpoints.
- ABUSE-018: Client input cannot cause uncontrolled log growth or sensitive-data logging.

---

# 17. Cross-transport consistency

This is extremely important to FlaRC's architecture.

For each important operation, repeat it through every supported transport.

Test that the same authorization outcome applies.

Examples:

| Operation | IRC | REST | Events |
|---|---|---|---|
| Authenticate account | SASL / services | Login | Authorized connection |
| Send message | PRIVMSG | POST message | Authorized delivery |
| Change topic | TOPIC | PATCH topic | Topic event |
| Assign operator | MODE / services | Role API | Role event |
| Ban user | MODE / services | Ban API | Membership update |
| Edit message | Extension | PATCH message | Message update |
| Redact message | Extension/moderation | DELETE message | Redaction event |
| Change profile | METADATA | PATCH profile | Profile update |
| Read history | CHATHISTORY | GET messages | Authorized recovery |

For each operation, test:

1. Authorized via IRC.
2. Authorized via REST.
3. Unauthorized via IRC.
4. Unauthorized via REST.
5. Correct real-time event delivery.
6. Correct persistence.
7. Correct authorization after reconnect.
8. Correct authorization after privilege revocation.

No interface may provide a less restrictive path to the same protected operation.

---

# 18. Authorization matrix generation

Avoid writing every combination manually.

Build reusable test helpers around:

- Actor.
- Resource.
- Operation.
- Transport.
- Expected authorization result.
- Expected persistent state.
- Expected event recipients.

Conceptually:
