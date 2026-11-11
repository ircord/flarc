# Authorization matrix

The route-level inventory is in [attack-surface.md](attack-surface.md). “Administrator” means an authenticated account with the current admin role, never possession of a static API token.

| Operation | Pre-auth visitor | Authenticated unrelated account | Authorized member/owner | Administrator | Authority |
|---|---|---|---|---|---|
| CAP, SASL/PASS, NICK/USER, REGISTER/VERIFY, PING/PONG, QUIT | Handshake only; signup policy applies | Yes | Yes | Yes | Session + Accounts |
| JOIN, PRIVMSG, NOTICE, TAGMSG, BATCH, RELAYMSG, roleplay | Deny | Channel/target policy | Channel and moderation rules | Assigned privileges | Channel/Session |
| CHATHISTORY/HISTORY, SEARCH, HistServ PLAY/EXPORT | Deny | Public history policy only | Membership/history policy | Channel administrative access | Channel |
| Secret/private/invite-only/keyed info/history/search/unread/media/events | Deny | Deny | Current membership or explicit retained founder grant; ban check | Channel admin only | Channel |
| DM history/media | Deny | Deny | Actual participants only | Deny unless participant | Session/Accounts |
| Message edit | Deny | Deny | Actual author ID only | Own messages | Channel |
| Channel message redact / HistServ DELETE | Deny | Deny | Author or channel moderator | Channel admin | Channel |
| DM redact | Deny | Deny | Author only | Own message only | Session |
| Topic/channel metadata/webhook management | Deny | Deny | Channel operator/founder | Yes | Channel |
| Role CRUD/assignments | Deny | Deny | Founder; scoped to channel | Yes | Channel |
| Profile read | Deny | Yes | Yes | Yes | Accounts |
| Profile write, subscriptions, notification preferences, read markers | Deny | Deny | Self only | Own resource through client API; separate admin routes | Accounts |
| NickServ GROUP/DROP/GHOST | Deny | Nick ownership/credential proof | Own registered identity | Administrative commands only | Accounts/Session |
| NickServ unregister/password/clients | Deny | Deny | Self only | Explicit SA/admin actions | Accounts/Session |
| HostServ SET/DEL, OPER, KILL, SAJOIN, SANICK, admin API | Deny | Deny | Assigned network privilege | Yes | Accounts + current session |
| ChanServ/F access changes | Deny | Deny | Current access and rank; no self elevation | Assigned administrative privilege | Channel |
| Incoming hook execution | Channel-scoped secret only | Same | Same | Same | Channel |
| Outbound previews/hooks | Deny | Auth + feature policy | Auth + channel management for hooks | Explicit HTTPS allowlists | Egress service |

Default deny applies to unknown client-domain operations. Internal privileged maintenance RPCs are not exposed as arbitrary client dispatch. Review the findings for verification limits and remaining P2/P3 work.

## Complete IRC dispatcher map

Unless explicitly listed as handshake-only, commands below require a registered authenticated account in the default configuration. IRC permits assigned network operators to perform explicit network/channel overrides; REST administration requires `admin`. Client-supplied prefixes, roles and account tags never authenticate a caller. Unknown commands are rejected.

| Commands | Resource / authorization | Persistent effects |
|---|---|---|
| CAP, AUTHENTICATE, PASS, NICK, USER, REGISTER, VERIFY, PING, PONG, QUIT | Pre-auth allowlist only; credential/signup/nickname ownership policy. VERIFY rejects unconfigured challenges. | REGISTER creates an account; auth attaches identity; QUIT cleans routing |
| WEBIRC | Pre-auth only; configured gateway secret; trusted gateways own forwarded identity metadata | Connection metadata only |
| JOIN, PART | Current principal; bans, invites/account-bound tickets, key, channel limits and persisted access; first creator can found a new channel | Membership, initial ChanServ registration/access, history events |
| PRIVMSG, NOTICE, TAGMSG, BATCH | Channel moderation/member policy or authenticated DM peer. Multiline and roleplay use the same DM writer. Service targets invoke the service policies below. | Messages/reactions/edits; typing tags are ephemeral |
| NPC, NPCA, SCENE, AMBIANCE | Same messaging checks plus target roleplay mode | Channel/DM history |
| RELAYMSG | Channel operator authority; explicit relayed identity, not account impersonation | Channel history |
| REDACT | Channel author/moderator or DM author and actual peer | Scrub logical message/edit chain and index |
| CHATHISTORY, HISTORY, SEARCH | Current channel authorization; IRC history currently requires membership; DM participants only | Reads; metadata counts filtered |
| NAMES, LIST, WHO, WHOIS, WHOWAS, USERHOST, ISON | Logged-in discovery; invisible/user and restricted-channel visibility policy | Reads |
| TOPIC, MODE | Channel rank/custom permissions; no changing higher privileges; live modes are distinct from ChanServ persistent grants | Channel metadata/moderation/live modes/history events |
| SAMODE | Assigned network operator | Same channel state with explicit operator override |
| INVITE, UNINVITE | Channel operator/rules; immutable recipient account/session and expiry | Invitations |
| RENAME | Source-owned live operator check; unoccupied destination; bounded snapshot. Failed/partial transitions deny ordinary access. | Atomic destination import, ACL/roles/messages/media/routing move; old generation cleared after commit |
| METADATA | Self user metadata; channel reads require visibility, writes require channel authority | Whitelisted metadata and subscriptions |
| MARKREAD | Self, authorized channel/DM target | Read marker for that account |
| SETNAME, AWAY, ACCEPT, LANGUAGE | Own connection only; ACCEPT cannot authenticate another identity | Own attachment/settings |
| CHGHOST | Assigned network operator, or server-internal approved HostServ action | Host metadata |
| MONITOR | Own bounded watchlist of authenticated-network presence | Own monitoring state |
| WEBPUSH | Own HTTPS subscriptions/keys, 20/account; VAPID only configured public key | Own subscription storage; no delivery implementation |
| PERSISTENCE | Own account/session persistence; channel restrictions remain | Own persistence and applicable membership |
| BOUNCER, ZNC, `*playback` target | Own network/settings and authorized channel/DM playback | Own configuration; playback reads |
| OPER, DEOPER | Real verified account with assigned network role; no default passwords | Own operator state |
| KILL, SAJOIN, SANICK, WALLOPS | Assigned network operator; account/nick ownership still applies | Disconnect/membership/nickname state or privileged broadcasts |
| WHOAMI, ISUPPORT, TIME, VERSION, INFO, HELP, HELPOP, MOTD, LUSERS, LINKS | Logged-in non-secret server/self information | None |
| NS/NICKSERV, CS/CHANSERV, HS/HOSTSERV, HISTSERV, F/FLARESERV/Q | Aliases enter the same service handlers; ordinary guests cannot invoke them | See service table |

## Service commands

| Service commands | Permission check / effect |
|---|---|
| NickServ REGISTER | Signup policy; account creation and explicit authenticated identity establishment |
| NickServ SAREGISTER, SADROP | Assigned network operator; controlled provisioning/deletion |
| NickServ IDENTIFY/LOGIN, F AUTH | Verify credentials; changing accounts drops old channel identity/membership |
| NickServ INFO/LIST | Authenticated account discovery; no password hashes/credentials/session secrets |
| NickServ GROUP/DROP | Own account + nickname ownership; cannot group an owned nickname |
| NickServ GHOST | Assigned operator, owning account, or actual credential proof |
| NickServ UNREGISTER/ERASE, PASSWD/PASSWORD | Own account; revoke sessions, preserve unrelated history |
| NickServ CLIENTS/SESSIONS, GET/SET | Own account; explicit operator session-list override; settings do not assign network roles |
| ChanServ INFO/LIST/HOWTOBAN, GET, AMODE listing; F STATUS/CHANLEV listing | Channel read authorization; restricted existence/membership/ACLs filtered |
| ChanServ REGISTER | Channel operator/member or assigned network override; creates explicit founder grant |
| ChanServ OP/DEOP | Current live/persistent rank, target-rank protection; halfops cannot promote themselves, DEOP never strips q/a |
| ChanServ AMODE; F CHANLEV changes | Current rank, no granting/changing higher ranks or demoting a higher target through a lower replacement; q/a reserved to founder/operator |
| ChanServ UNREGISTER/DROP/PURGE, CLEAR, TRANSFER, SET | Founder/current scoped authority or explicit operator; confirmations/transfer target checks. CLEAR access removes affected live persistent flags too. |
| F REQUESTBOT/UNREQUESTBOT, OP/DEOP/VOICE/DEVOICE, WELCOME | Channel owner/operator authority and domain rank checks; does not grant network privileges |
| HostServ STATUS/ON/OFF | Own assigned vhost only |
| HostServ SET/DEL | Assigned network operator; account target is not authorization |
| HistServ PLAY/EXPORT | Current channel history access |
| HistServ DELETE | Actual channel author/moderator or DM author; no cross-user deletion |
| HistServ FORGET | Own immutable author ID; explicit operator override for channel administration |
| HELP / unknown service subcommands | Non-secret usage or rejection; no implicit permission grants |

## Transport differences and limits

The same account/author/channel policies protect each interface, but feature sets are not identical. IRC history currently requires channel membership even for public channels; REST public history allows authenticated readers. REST profile discovery is authenticated-public. The event stream sends authorized channel events only; DMs have no event subscription API. A pending/expired API session cannot subscribe, and a revoked parent session loses future event access. Account reset/disable/delete disconnects live IRC sessions; API logout revokes only that API credential and child tickets, not independent IRC logins.

Voice/halfop/operator status is not a network administrator role. Permission failures are verified against genuinely independent authenticated accounts, including a two-device role revocation case; see [test evidence](security-test-results.md). Authorized retained-history access predates membership by explicit policy. No group-DM removal policy exists because group DMs are not implemented.
