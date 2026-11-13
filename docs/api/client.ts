export interface paths {
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Public health */
        get: operations["get_health"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Public status */
        get: operations["get_status"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/register": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create an account under the server signup policy
         * @description Signup defaults closed. Public input cannot assign roles. Password length is enforced by server policy (secure default 12 characters, maximum 1024). Bootstrap credentials do not authorize administrative APIs.
         */
        post: operations["post_api_v1_auth_register"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Authenticate and create an expiring API session
         * @description Returns a random 256-bit bearer token, expiring after 24 hours. Up to 20 sessions per account. Tokens are stored as hashes; password reset, disable/delete, and logout revoke access. Invalid credentials return 401. With X-FlaRC-Session: cookie and an allowed Origin, sets __Host-flarc_session (Secure, HttpOnly, SameSite=Strict, Path=/) and returns csrfToken instead of token. Subsequent cookie mutations require an allowed Origin and the session-bound X-CSRF-Token. Bearer requests do not use CSRF tokens.
         */
        post: operations["post_api_v1_auth_login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List your active sessions and integration credentials */
        get: operations["get_api_v1_auth_sessions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/sessions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Revoke one of your sessions or integration credentials
         * @description Uses the opaque id from the session directory. Other accounts' sessions are forbidden. Revocation preserves unrelated sessions and independently password-authenticated IRC devices.
         */
        delete: operations["delete_api_v1_auth_sessions_by_id"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/credentials": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Issue an expiring integration credential with explicit scopes
         * @description The secret token is returned once. Effective permission is the intersection of current account authority, credential scopes, REST operation/path scope and owning-object scope. A scoped credential cannot delegate broader authority. Revoke using DELETE /api/v1/auth/sessions/{id}.
         */
        post: operations["post_api_v1_auth_credentials"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Revoke the current API session */
        post: operations["post_api_v1_auth_logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/events-ticket": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Issue a 30-second, single-use event connection ticket
         * @description Use the ticket in the events WebSocket handshake. Reusable session credentials must not be put in a URL.
         */
        post: operations["post_api_v1_auth_events_ticket"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Authenticated WebSocket events
         * @description Upgrade: websocket required (426 otherwise). Non-browser clients may send Authorization: Bearer; browser clients use a short-lived ticket. Send EventCommand subscribe/replay/bootstrap/mutate frames. Durable replay uses account-bound cursors with original-audience and current-authority checks; CURSOR_EXPIRED requires bootstrap/resync. Legacy automatic public observation grants no historical replay rights. Results use type=result/requestId/result; errors use type=error/requestId/status/code/message/resync. Negotiate flarc.events.v2, accept EventStreamHello, and answer each ReaderChallenge exactly once with ReaderAck after reading its preceding frames. Outstanding output is bounded to 262144 encoded bytes, 1024 frames and 30 seconds; invalid or expired ACKs close with code 1008. Version 1 receives explicit resync.required/READER_ACK_REQUIRED and closes when acknowledgment is required. The five-connections/account and 2000-connections/network limits are enforced across all server-selected shards. Caller account/shard selectors are forbidden. Cross-origin browsers require ALLOWED_ORIGINS.
         */
        get: operations["get_api_v1_events"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/profiles/{username}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read a registered profile */
        get: operations["get_api_v1_profiles_by_username"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Update your own profile
         * @description The authenticated account must own this profile; the client API does not grant an administrator override. Optional expectedRevision rejects stale updates with 409, and clientOperationId makes retries idempotent. Null clears a field. Persisted changes publish to authorized IRC and event observers.
         */
        patch: operations["patch_api_v1_profiles_by_username"];
        trace?: never;
    };
    "/api/v1/conversations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List your direct conversations
         * @description Sorted by creation time and immutable ID. The after cursor must identify your own conversation. Continue with nextConversationId until null. Joined channels are returned separately by event bootstrap.
         */
        get: operations["get_api_v1_conversations"];
        put?: never;
        /**
         * Resolve or create a direct conversation with an account
         * @description Requires current immutable account participation; administrator role alone grants no access. URL IDs select resources, never the authenticated sender. Optional senderId and recipientId selectors must be participants. clientOperationId uses epoch milliseconds followed by a dot and UUID, with a 24-hour retry window and five-minute future skew allowance. Identical retries return the original result; conflicting payloads return 409.
         */
        post: operations["post_api_v1_conversations"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/conversations/{conversation}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read an authorized conversation
         * @description Requires current immutable account participation; administrator role alone grants no access. URL IDs select resources, never the authenticated sender. Optional senderId and recipientId selectors must be participants. clientOperationId uses epoch milliseconds followed by a dot and UUID, with a 24-hour retry window and five-minute future skew allowance. Identical retries return the original result; conflicting payloads return 409.
         */
        get: operations["get_api_v1_conversations_by_conversation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/conversations/{conversation}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read participant-only canonical message history
         * @description Requires current immutable account participation; administrator role alone grants no access. URL IDs select resources, never the authenticated sender. Optional senderId and recipientId selectors must be participants. clientOperationId uses epoch milliseconds followed by a dot and UUID, with a 24-hour retry window and five-minute future skew allowance. Identical retries return the original result; conflicting payloads return 409. before/after are message IDs in this conversation. Expired or absent references return a safe error. Messages are returned chronologically within the selected window. Redacted bodies are null; hasMore means another row matches the selected boundaries, not separate older/newer flags.
         */
        get: operations["get_api_v1_conversations_by_conversation_messages"];
        put?: never;
        /**
         * Send a durable direct message
         * @description Requires current immutable account participation; administrator role alone grants no access. URL IDs select resources, never the authenticated sender. Optional senderId and recipientId selectors must be participants. clientOperationId uses epoch milliseconds followed by a dot and UUID, with a 24-hour retry window and five-minute future skew allowance. Identical retries return the original result; conflicting payloads return 409.
         */
        post: operations["post_api_v1_conversations_by_conversation_messages"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/conversations/{conversation}/messages/{message}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read a participant-only message by ID
         * @description Requires current immutable account participation; administrator role alone grants no access. URL IDs select resources, never the authenticated sender. Optional senderId and recipientId selectors must be participants. clientOperationId uses epoch milliseconds followed by a dot and UUID, with a 24-hour retry window and five-minute future skew allowance. Identical retries return the original result; conflicting payloads return 409.
         */
        get: operations["get_api_v1_conversations_by_conversation_messages_by_message"];
        put?: never;
        post?: never;
        /**
         * Redact your own direct message at its current revision
         * @description Requires current immutable account participation; administrator role alone grants no access. URL IDs select resources, never the authenticated sender. Optional senderId and recipientId selectors must be participants. clientOperationId uses epoch milliseconds followed by a dot and UUID, with a 24-hour retry window and five-minute future skew allowance. Identical retries return the original result; conflicting payloads return 409.
         */
        delete: operations["delete_api_v1_conversations_by_conversation_messages_by_message"];
        options?: never;
        head?: never;
        /**
         * Edit your own direct message at its current revision
         * @description Requires current immutable account participation; administrator role alone grants no access. URL IDs select resources, never the authenticated sender. Optional senderId and recipientId selectors must be participants. clientOperationId uses epoch milliseconds followed by a dot and UUID, with a 24-hour retry window and five-minute future skew allowance. Identical retries return the original result; conflicting payloads return 409.
         */
        patch: operations["patch_api_v1_conversations_by_conversation_messages_by_message"];
        trace?: never;
    };
    "/api/v1/conversations/{conversation}/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Advance your durable read marker and notify your other clients
         * @description Requires current immutable account participation; administrator role alone grants no access. URL IDs select resources, never the authenticated sender. Optional senderId and recipientId selectors must be participants. clientOperationId uses epoch milliseconds followed by a dot and UUID, with a 24-hour retry window and five-minute future skew allowance. Identical retries return the original result; conflicting payloads return 409.
         */
        post: operations["post_api_v1_conversations_by_conversation_read"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/conversations/{conversation}/unread": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read your conversation unread count
         * @description Requires current immutable account participation; administrator role alone grants no access. URL IDs select resources, never the authenticated sender. Optional senderId and recipientId selectors must be participants. clientOperationId uses epoch milliseconds followed by a dot and UUID, with a 24-hour retry window and five-minute future skew allowance. Identical retries return the original result; conflicting payloads return 409.
         */
        get: operations["get_api_v1_conversations_by_conversation_unread"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/conversations/{conversation}/attachments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List attachment metadata visible to a conversation participant
         * @description Requires current immutable account participation; administrator role alone grants no access. URL IDs select resources, never the authenticated sender. Optional senderId and recipientId selectors must be participants. clientOperationId uses epoch milliseconds followed by a dot and UUID, with a 24-hour retry window and five-minute future skew allowance. Identical retries return the original result; conflicting payloads return 409.
         */
        get: operations["get_api_v1_conversations_by_conversation_attachments"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/dms/messages/{message}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Look up a direct message using authenticated participation
         * @description Requires current immutable account participation; administrator role alone grants no access. URL IDs select resources, never the authenticated sender. Optional senderId and recipientId selectors must be participants. clientOperationId uses epoch milliseconds followed by a dot and UUID, with a 24-hour retry window and five-minute future skew allowance. Identical retries return the original result; conflicting payloads return 409.
         */
        get: operations["get_api_v1_dms_messages_by_message"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/metadata/{target}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read visible account metadata
         * @description Public custom metadata is visible to authenticated accounts. Keys prefixed private: are owner-only and require the credential's private-metadata scope. Administrator status does not grant private metadata publication.
         */
        get: operations["get_api_v1_metadata_by_target"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Update or clear your own metadata with optional revision protection
         * @description value=null clears the key. expectedRevision conflicts return 409. Public and owner-only private: updates are delivered through separate authorized event audiences.
         */
        patch: operations["patch_api_v1_metadata_by_target"];
        trace?: never;
    };
    "/api/v1/events/replay": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Replay currently authorized durable changes after your cursor
         * @description Cursors belong to an immutable account and grant no permissions. Replay checks original audience and current credentials, channel generation, participation and message redaction/expiry. A 410 CURSOR_EXPIRED requires bootstrap/resync. Replay never repeats mutations; de-duplicate eventId. An empty page may still advance cursor while filtering inaccessible events.
         */
        get: operations["get_api_v1_events_replay"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/events/bootstrap": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read an initial account snapshot and recovery cursor
         * @description The initial recovery cursor precedes resource snapshot reads and is preserved across pages. Replay from it and de-duplicate event IDs, message IDs and resource revisions. Only currently authorized joined/persistent-membership channels are returned; bootstrap consumes no public-observer slots. Follow nextPageToken until channelsComplete; a page may contain no visible channels while scanning a bounded portion of the directory. Tokens are opaque, account-bound, capped at 64 per account and expire within 15 minutes or with the original recovery cursor, whichever is earlier. Foreign tokens return 403; expired tokens return 410 and require bootstrap/resync. Channel snapshots include metadata, recent history and read markers. This is not an atomic transaction across Durable Objects. Continue the conversation directory separately with nextConversationId.
         */
        get: operations["get_api_v1_events_bootstrap"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/channels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List channels visible to the authenticated account */
        get: operations["get_api_v1_channels"];
        put?: never;
        /**
         * Create a channel with atomic privacy settings and founder
         * @description Requires an authenticated account. Defaults to secret. Founder, settings and persistent account membership commit together. An existing name, pending retirement or unsafe legacy archive returns 409; no temporary public channel is created.
         */
        post: operations["post_api_v1_channels"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/channels/{channel}/join": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Join with the same key, invite and ban policy as IRC
         * @description Creates account membership without requiring an IRC socket and reconciles active devices. Channel keys are not included in the response.
         */
        post: operations["post_api_v1_channels_by_channel_join"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/channels/{channel}/leave": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Leave the channel across the account's memberships */
        post: operations["post_api_v1_channels_by_channel_leave"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/channels/{channel}/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List members of an authorized channel */
        get: operations["get_api_v1_channels_by_channel_members"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/channels/{channel}/invites": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Invite an account using current channel permissions */
        post: operations["post_api_v1_channels_by_channel_invites"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/channels/{channel}/invites/{username}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Revoke a channel invitation */
        delete: operations["delete_api_v1_channels_by_channel_invites_by_username"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/channels/{channel}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Retire a channel as its founder
         * @description Retains the old generation's history in an inaccessible archive unless purge is explicitly true. Revokes current memberships, roles, invitations, webhooks and event observers. The returned generation identifies the retirement tombstone; a later creation receives another fresh generation.
         */
        delete: operations["delete_api_v1_channels_by_channel"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/channels/{channel}/messages/bulk-redact": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Atomically redact authorized messages in one channel
         * @description Checks permission for every target before modifying any message. operationId is Unix epoch milliseconds followed by a dot and UUID, valid for 24 hours with at most five minutes of future clock skew. Identical retries return the stored result; a conflicting payload returns 409. A denied target leaves the whole batch unchanged.
         */
        post: operations["post_api_v1_channels_by_channel_messages_bulk_redact"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/channels/{channel}/info": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read authorized channel metadata
         * @description Pass the IRC channel name URL-encoded, e.g. %23general. Public history requires authentication. Secret/private/invite-only/keyed channels require authorized membership or a persistent founder grant; bans deny ordinary reads. Members can read retained history predating their join. Re-created channels receive a fresh generation; retained archives and old permissions remain inaccessible to the new generation. Legacy archives with residual active state cannot be reused. Restricted STATUSMSG/+U message bodies are excluded from general CHATHISTORY and REST history; eligible recipients can recover them through the authorized event journal within its retention window.
         */
        get: operations["get_api_v1_channels_by_channel_info"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Update channel metadata as an operator/founder
         * @description Current channel management permission is checked by ChannelDO; selected custom role grants are authoritative.
         */
        patch: operations["patch_api_v1_channels_by_channel_info"];
        trace?: never;
    };
    "/api/v1/channels/{channel}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read authorized retained channel messages
         * @description Pass the IRC channel name URL-encoded, e.g. %23general. Public history requires authentication. Secret/private/invite-only/keyed channels require authorized membership or a persistent founder grant; bans deny ordinary reads. Members can read retained history predating their join. Re-created channels receive a fresh generation; retained archives and old permissions remain inaccessible to the new generation. Legacy archives with residual active state cannot be reused. Restricted STATUSMSG/+U message bodies are excluded from general CHATHISTORY and REST history; eligible recipients can recover them through the authorized event journal within its retention window. Redacted and expired rows are excluded. before/after use stable message sequence ordering; pagination.has_more uses one extra row.
         */
        get: operations["get_api_v1_channels_by_channel_messages"];
        put?: never;
        /**
         * Send a message as the authenticated channel member
         * @description Join the channel first. Sender identity comes from the verified account and membership; senderNick is a deprecated ignored input. Only valid client-prefixed tags are accepted. Channel moderation, bans and read-only policy also apply to REST. A 201 means committed storage; live events and outgoing delivery do not provide a durable delivery guarantee.
         */
        post: operations["post_api_v1_channels_by_channel_messages"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/channels/{channel}/messages/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Redact your message or moderate a channel message
         * @description Current channel access plus author/moderator authority is required. Text, multiline payloads, tags and FTS entries are scrubbed.
         */
        delete: operations["delete_api_v1_channels_by_channel_messages_by_id"];
        options?: never;
        head?: never;
        /**
         * Edit your own unredacted, unexpired message
         * @description Ownership uses the immutable author account ID. A current channel membership is required. A client-provided senderNick cannot establish ownership.
         */
        patch: operations["patch_api_v1_channels_by_channel_messages_by_id"];
        trace?: never;
    };
    "/api/v1/channels/{channel}/messages/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Search authorized channel history
         * @description Pass the IRC channel name URL-encoded, e.g. %23general. Public history requires authentication. Secret/private/invite-only/keyed channels require authorized membership or a persistent founder grant; bans deny ordinary reads. Members can read retained history predating their join. Re-created channels receive a fresh generation; retained archives and old permissions remain inaccessible to the new generation. Legacy archives with residual active state cannot be reused. Restricted STATUSMSG/+U message bodies are excluded from general CHATHISTORY and REST history; eligible recipients can recover them through the authorized event journal within its retention window.
         */
        get: operations["get_api_v1_channels_by_channel_messages_search"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Search visible channel history
         * @description Explicit unauthorized channel scopes return 403. Broad searches omit inaccessible channels from results and the returned channel list. This endpoint does not search DMs.
         */
        get: operations["get_api_v1_search"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/dms/{target}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read a direct conversation you participate in
         * @description target and user identify registered account names, not proof of participation or reusable IRC nicknames. DMs are keyed by immutable account IDs. Administrators have no participant bypass. Redacted/expired records are excluded. Legacy nickname-keyed records are retained but quarantined from guessed ownership.
         */
        get: operations["get_api_v1_dms_by_target_messages"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/channels/{channel}/roles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read authorized channel role definitions
         * @description Pass the IRC channel name URL-encoded, e.g. %23general. Public history requires authentication. Secret/private/invite-only/keyed channels require authorized membership or a persistent founder grant; bans deny ordinary reads. Members can read retained history predating their join. Re-created channels receive a fresh generation; retained archives and old permissions remain inaccessible to the new generation. Legacy archives with residual active state cannot be reused. Restricted STATUSMSG/+U message bodies are excluded from general CHATHISTORY and REST history; eligible recipients can recover them through the authorized event journal within its retention window.
         */
        get: operations["get_api_v1_channels_by_channel_roles"];
        put?: never;
        /** Create a channel role as founder/administrator */
        post: operations["post_api_v1_channels_by_channel_roles"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/channels/{channel}/roles/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete a role and cascade its assignments */
        delete: operations["delete_api_v1_channels_by_channel_roles_by_id"];
        options?: never;
        head?: never;
        /** Update a channel role as founder/administrator */
        patch: operations["patch_api_v1_channels_by_channel_roles_by_id"];
        trace?: never;
    };
    "/api/v1/channels/{channel}/roles/assign": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Assign/remove an account's channel role
         * @description Founder/administrator authority is required; userId selects the target account, never the caller. Role group and assignment remain scoped to this channel. Derived mode permissions are read from current persisted assignments.
         */
        post: operations["post_api_v1_channels_by_channel_roles_assign"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/channels/{channel}/unread": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read your authorized channel unread count
         * @description Pass the IRC channel name URL-encoded, e.g. %23general. Public history requires authentication. Secret/private/invite-only/keyed channels require authorized membership or a persistent founder grant; bans deny ordinary reads. Members can read retained history predating their join. Re-created channels receive a fresh generation; retained archives and old permissions remain inaccessible to the new generation. Legacy archives with residual active state cannot be reused. Restricted STATUSMSG/+U message bodies are excluded from general CHATHISTORY and REST history; eligible recipients can recover them through the authorized event journal within its retention window.
         */
        get: operations["get_api_v1_channels_by_channel_unread"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/{username}/unread": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read your visible-channel unread summaries
         * @description Self only; inaccessible channel names/counts are omitted. Read markers are updated through authenticated IRC MARKREAD.
         */
        get: operations["get_api_v1_users_by_username_unread"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/{username}/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List your notification preferences */
        get: operations["get_api_v1_users_by_username_notifications"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/{username}/notifications/{channel}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set your channel notification preference
         * @description Self only. This configures preferences; it does not promise an implemented external push delivery service.
         */
        put: operations["put_api_v1_users_by_username_notifications_by_channel"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications/subscribe": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Store your HTTPS push subscription
         * @description Self only. Subscription persistence is implemented; encrypted WebPush delivery and configurable VAPID signing remain unimplemented.
         */
        post: operations["post_api_v1_notifications_subscribe"];
        /** Remove your push subscription */
        delete: operations["delete_api_v1_notifications_subscribe"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications/subscriptions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List your push subscription endpoints */
        get: operations["get_api_v1_notifications_subscriptions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/media/upload": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Upload private or explicitly scoped media
         * @description No scope means uploader-only. Requires a logged-in API session; nickname/Basic headers do not authenticate. The file limit defaults to 10 MiB and is configurable with FILEHOST_MAX_UPLOAD_BYTES; multipart framing has a separate 64 KiB allowance. Stored quota is 100 MiB per account. R2 is private and accessed only after persisted scope checks. Unowned legacy files are quarantined.
         */
        post: operations["post_api_v1_media_upload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/media/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Download authorized media
         * @description Authentication and stored uploader/channel/DM scope are checked before R2/SQLite retrieval. Unauthorized or unknown files return 404. Responses use private no-store caching, nosniff, CSP sandbox and attachment disposition for active content.
         */
        get: operations["get_media_by_id"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/media/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete your uploaded media
         * @description Uploader only; unknown/not-owned returns 404. R2 deletion completes before access metadata is removed.
         */
        delete: operations["delete_api_v1_media_by_id"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/embeds": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Resolve metadata from an operator-allowed HTTPS host
         * @description Outbound previews are disabled without EMBED_ALLOWED_HOSTS. Each redirect and discovered oEmbed destination must also be allowed. Fetches have byte/time bounds; executable oEmbed HTML is not returned.
         */
        get: operations["get_api_v1_embeds"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/channels/{channel}/webhooks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List channel webhook capabilities
         * @description Channel management permission required; response includes secret execution tokens.
         */
        get: operations["get_api_v1_channels_by_channel_webhooks"];
        put?: never;
        /**
         * Create a channel-scoped incoming webhook capability
         * @description Channel operator/founder/admin only. The creator comes from the authenticated account.
         */
        post: operations["post_api_v1_channels_by_channel_webhooks"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/channels/{channel}/webhooks/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete a channel webhook capability */
        delete: operations["delete_api_v1_channels_by_channel_webhooks_by_id"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/webhooks/{token}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Execute a channel-scoped webhook capability
         * @description The path token is authentication for a narrowly scoped bot operation, not anonymous user access. Either content or embeds is required. The token must belong to the selected channel; archived channels revoke old hooks. IRC nicknames are namespaced as hook_* and the requested display name is a tag, never a registered account identity.
         */
        post: operations["post_api_v1_webhooks_by_token"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/channels/{channel}/outgoing-webhooks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List channel outgoing hooks */
        get: operations["get_api_v1_channels_by_channel_outgoing_webhooks"];
        put?: never;
        /**
         * Configure an operator-allowed HTTPS outgoing hook
         * @description Channel management permission and an explicit OUTGOING_WEBHOOK_ALLOWED_HOSTS match are required. Redirects are rejected. Delivery is best effort after storage commits; no durable retry/outbox guarantee is made.
         */
        post: operations["post_api_v1_channels_by_channel_outgoing_webhooks"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/channels/{channel}/outgoing-webhooks/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove a channel outgoing hook */
        delete: operations["delete_api_v1_channels_by_channel_outgoing_webhooks_by_id"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/media": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List authorized private media or your pending uploads
         * @description Choose at most one of channel, dm or pending=1. With no selector, lists your private uploads. Channel authority and immutable DM participation are checked before returning metadata. Pending uploads are owner-only; DELETE /api/v1/media/{id} also cancels a pending upload. At most 100 items are returned.
         */
        get: operations["get_api_v1_media"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/config": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Persist network runtime configuration
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_api_v1_admin_config"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/config": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Persist network runtime configuration
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_admin_config"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/stats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Inspect network statistics
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_api_v1_admin_stats"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/stats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Inspect network statistics
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_admin_stats"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/broadcast": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Broadcast a network notice
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_api_v1_admin_broadcast"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/broadcast": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Broadcast a network notice
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_admin_broadcast"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List live IRC sessions
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_api_v1_admin_sessions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List live IRC sessions
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_admin_sessions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/sessions/disconnect": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Disconnect a selected IRC session
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_api_v1_admin_sessions_disconnect"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/sessions/disconnect": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Disconnect a selected IRC session
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_admin_sessions_disconnect"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/accounts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List accounts including disabled status
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_api_v1_admin_accounts"];
        put?: never;
        /**
         * Provision an account with explicit roles
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_api_v1_admin_accounts"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/accounts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List accounts including disabled status
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_admin_accounts"];
        put?: never;
        /**
         * Provision an account with explicit roles
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_admin_accounts"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/accounts/disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Disable an account and disconnect its sessions
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_api_v1_admin_accounts_disable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/accounts/disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Disable an account and disconnect its sessions
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_admin_accounts_disable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/accounts/{username}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Inspect account, nicknames and metadata
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_api_v1_admin_accounts_by_username"];
        put?: never;
        post?: never;
        /**
         * Delete account-owned state; preserve channel history
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        delete: operations["delete_api_v1_admin_accounts_by_username"];
        options?: never;
        head?: never;
        /**
         * Update explicit account fields
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        patch: operations["patch_api_v1_admin_accounts_by_username"];
        trace?: never;
    };
    "/admin/accounts/{username}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Inspect account, nicknames and metadata
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_admin_accounts_by_username"];
        put?: never;
        post?: never;
        /**
         * Delete account-owned state; preserve channel history
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        delete: operations["delete_admin_accounts_by_username"];
        options?: never;
        head?: never;
        /**
         * Update explicit account fields
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        patch: operations["patch_admin_accounts_by_username"];
        trace?: never;
    };
    "/api/v1/admin/accounts/{username}/password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Atomically reset credentials and revoke sessions
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_api_v1_admin_accounts_by_username_password"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/accounts/{username}/password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Atomically reset credentials and revoke sessions
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_admin_accounts_by_username_password"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/accounts/{username}/disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Disable account and revoke sessions
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_api_v1_admin_accounts_by_username_disable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/accounts/{username}/disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Disable account and revoke sessions
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_admin_accounts_by_username_disable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/accounts/{username}/enable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Re-enable an account without restoring revoked credentials
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_api_v1_admin_accounts_by_username_enable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/accounts/{username}/enable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Re-enable an account without restoring revoked credentials
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_admin_accounts_by_username_enable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/accounts/{username}/roles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read assigned global roles
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_api_v1_admin_accounts_by_username_roles"];
        put?: never;
        /**
         * Grant/revoke a global role
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_api_v1_admin_accounts_by_username_roles"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/accounts/{username}/roles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read assigned global roles
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_admin_accounts_by_username_roles"];
        put?: never;
        /**
         * Grant/revoke a global role
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_admin_accounts_by_username_roles"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/profile/{username}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read an account profile
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_api_v1_admin_profile_by_username"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Administratively update a profile
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        patch: operations["patch_api_v1_admin_profile_by_username"];
        trace?: never;
    };
    "/admin/profile/{username}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read an account profile
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_admin_profile_by_username"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Administratively update a profile
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        patch: operations["patch_admin_profile_by_username"];
        trace?: never;
    };
    "/api/v1/admin/messages/redact": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Redact a channel message
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_api_v1_admin_messages_redact"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/messages/redact": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Redact a channel message
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_admin_messages_redact"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/channels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List channel inventory
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_api_v1_admin_channels"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/channels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List channel inventory
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_admin_channels"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/channels/{channel}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Inspect full channel state
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_api_v1_admin_channels_by_channel"];
        put?: never;
        post?: never;
        /**
         * Archive a channel, optionally purge its messages
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        delete: operations["delete_api_v1_admin_channels_by_channel"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/channels/{channel}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Inspect full channel state
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_admin_channels_by_channel"];
        put?: never;
        post?: never;
        /**
         * Archive a channel, optionally purge its messages
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        delete: operations["delete_admin_channels_by_channel"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/channels/{channel}/info": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Inspect channel metadata
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_api_v1_admin_channels_by_channel_info"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Administratively update channel metadata
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        patch: operations["patch_api_v1_admin_channels_by_channel_info"];
        trace?: never;
    };
    "/admin/channels/{channel}/info": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Inspect channel metadata
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_admin_channels_by_channel_info"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Administratively update channel metadata
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        patch: operations["patch_admin_channels_by_channel_info"];
        trace?: never;
    };
    "/api/v1/admin/channels/{channel}/register": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Register an existing account as channel founder
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_api_v1_admin_channels_by_channel_register"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/channels/{channel}/register": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Register an existing account as channel founder
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_admin_channels_by_channel_register"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/channels/{channel}/unregister": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Unregister a channel
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_api_v1_admin_channels_by_channel_unregister"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/channels/{channel}/unregister": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Unregister a channel
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_admin_channels_by_channel_unregister"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/channels/{channel}/modes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Apply channel modes
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_api_v1_admin_channels_by_channel_modes"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/channels/{channel}/modes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Apply channel modes
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_admin_channels_by_channel_modes"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/channels/{channel}/topic": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Set a channel topic
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_api_v1_admin_channels_by_channel_topic"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/channels/{channel}/topic": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Set a channel topic
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_admin_channels_by_channel_topic"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/channels/{channel}/kick": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Remove a channel member
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_api_v1_admin_channels_by_channel_kick"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/channels/{channel}/kick": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Remove a channel member
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_admin_channels_by_channel_kick"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/channels/{channel}/bot": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Inspect F bot configuration
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_api_v1_admin_channels_by_channel_bot"];
        put?: never;
        /**
         * Configure the channel F bot
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_api_v1_admin_channels_by_channel_bot"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/channels/{channel}/bot": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Inspect F bot configuration
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_admin_channels_by_channel_bot"];
        put?: never;
        /**
         * Configure the channel F bot
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_admin_channels_by_channel_bot"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/channels/{channel}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Inspect stored channel records
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_api_v1_admin_channels_by_channel_messages"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/channels/{channel}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Inspect stored channel records
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_admin_channels_by_channel_messages"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/channels/{channel}/messages/purge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Purge channel messages by an explicit boundary
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_api_v1_admin_channels_by_channel_messages_purge"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/channels/{channel}/messages/purge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Purge channel messages by an explicit boundary
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_admin_channels_by_channel_messages_purge"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/metadata/users/{target}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Inspect metadata
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_api_v1_admin_metadata_users_by_target"];
        /**
         * Set validated metadata entries
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        put: operations["put_api_v1_admin_metadata_users_by_target"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/metadata/users/{target}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Inspect metadata
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_admin_metadata_users_by_target"];
        /**
         * Set validated metadata entries
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        put: operations["put_admin_metadata_users_by_target"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/metadata/users/{target}/{key}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Remove a metadata entry
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        delete: operations["delete_api_v1_admin_metadata_users_by_target_by_key"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/metadata/users/{target}/{key}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Remove a metadata entry
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        delete: operations["delete_admin_metadata_users_by_target_by_key"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/metadata/channels/{target}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Inspect metadata
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_api_v1_admin_metadata_channels_by_target"];
        /**
         * Set validated metadata entries
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        put: operations["put_api_v1_admin_metadata_channels_by_target"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/metadata/channels/{target}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Inspect metadata
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_admin_metadata_channels_by_target"];
        /**
         * Set validated metadata entries
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        put: operations["put_admin_metadata_channels_by_target"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/metadata/channels/{target}/{key}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Remove a metadata entry
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        delete: operations["delete_api_v1_admin_metadata_channels_by_target_by_key"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/metadata/channels/{target}/{key}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Remove a metadata entry
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        delete: operations["delete_admin_metadata_channels_by_target_by_key"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/accounts/{username}/scopes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read configured administrator scope restrictions
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_api_v1_admin_accounts_by_username_scopes"];
        /**
         * Replace administrator scope grants within your authority
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        put: operations["put_api_v1_admin_accounts_by_username_scopes"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/accounts/{username}/scopes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read configured administrator scope restrictions
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_admin_accounts_by_username_scopes"];
        /**
         * Replace administrator scope grants within your authority
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        put: operations["put_admin_accounts_by_username_scopes"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/accounts/{username}/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List a permitted account's active sessions
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_api_v1_admin_accounts_by_username_sessions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/accounts/{username}/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List a permitted account's active sessions
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_admin_accounts_by_username_sessions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/accounts/{username}/sessions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Revoke a permitted account's session or bot credential
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        delete: operations["delete_api_v1_admin_accounts_by_username_sessions_by_id"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/accounts/{username}/sessions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Revoke a permitted account's session or bot credential
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        delete: operations["delete_admin_accounts_by_username_sessions_by_id"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/bans": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List network account and trusted-hostmask bans
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_api_v1_admin_bans"];
        put?: never;
        /**
         * Create a network ban within your configured scope
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_api_v1_admin_bans"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/bans": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List network account and trusted-hostmask bans
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_admin_bans"];
        put?: never;
        /**
         * Create a network ban within your configured scope
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_admin_bans"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/bans/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Remove a permitted network ban
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        delete: operations["delete_api_v1_admin_bans_by_id"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/bans/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Remove a permitted network ban
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        delete: operations["delete_admin_bans_by_id"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/audit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read sanitized administrator and service audit records
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_api_v1_admin_audit"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/audit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read sanitized administrator and service audit records
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        get: operations["get_admin_audit"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/accounts/register": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Provision an account with explicit roles
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_api_v1_admin_accounts_register"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/accounts/register": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Provision an account with explicit roles
         * @description Requires the current administrator role and configured account/credential scope for this operation and target. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied. Audit collection is off by default; AUDIT_LOG_ENABLED=true enables sanitized actor/action/target/outcome records. Network administrator status does not grant private conversation participation.
         */
        post: operations["post_admin_accounts_register"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Authenticated WebSocket events
         * @description Legacy/compatibility alias of /api/v1/events. Upgrade: websocket required (426 otherwise). Non-browser clients may send Authorization: Bearer; browser clients use a short-lived ticket. Send EventCommand subscribe/replay/bootstrap/mutate frames. Durable replay uses account-bound cursors with original-audience and current-authority checks; CURSOR_EXPIRED requires bootstrap/resync. Legacy automatic public observation grants no historical replay rights. Results use type=result/requestId/result; errors use type=error/requestId/status/code/message/resync. Negotiate flarc.events.v2, accept EventStreamHello, and answer each ReaderChallenge exactly once with ReaderAck after reading its preceding frames. Outstanding output is bounded to 262144 encoded bytes, 1024 frames and 30 seconds; invalid or expired ACKs close with code 1008. Version 1 receives explicit resync.required/READER_ACK_REQUIRED and closes when acknowledgment is required. The five-connections/account and 2000-connections/network limits are enforced across all server-selected shards. Caller account/shard selectors are forbidden. Cross-origin browsers require ALLOWED_ORIGINS.
         */
        get: operations["get_api_events"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/accounts/register": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create an account under the server signup policy
         * @description Legacy/compatibility alias of /api/v1/auth/register. Signup defaults closed. Public input cannot assign roles. Password length is enforced by server policy (secure default 12 characters, maximum 1024). Bootstrap credentials do not authorize administrative APIs.
         */
        post: operations["post_api_accounts_register"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/profile/{username}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read a registered profile
         * @description Legacy/compatibility alias of /api/v1/profiles/{username}.
         */
        get: operations["get_api_profile_by_username"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Update your own profile
         * @description Legacy/compatibility alias of /api/v1/profiles/{username}. The authenticated account must own this profile; the client API does not grant an administrator override. Optional expectedRevision rejects stale updates with 409, and clientOperationId makes retries idempotent. Null clears a field. Persisted changes publish to authorized IRC and event observers.
         */
        patch: operations["patch_api_profile_by_username"];
        trace?: never;
    };
    "/api/channels/{channel}/info": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read authorized channel metadata
         * @description Legacy/compatibility alias of /api/v1/channels/{channel}/info. Pass the IRC channel name URL-encoded, e.g. %23general. Public history requires authentication. Secret/private/invite-only/keyed channels require authorized membership or a persistent founder grant; bans deny ordinary reads. Members can read retained history predating their join. Re-created channels receive a fresh generation; retained archives and old permissions remain inaccessible to the new generation. Legacy archives with residual active state cannot be reused. Restricted STATUSMSG/+U message bodies are excluded from general CHATHISTORY and REST history; eligible recipients can recover them through the authorized event journal within its retention window.
         */
        get: operations["get_api_channels_by_channel_info"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Update channel metadata as an operator/founder
         * @description Legacy/compatibility alias of /api/v1/channels/{channel}/info. Current channel management permission is checked by ChannelDO; selected custom role grants are authoritative.
         */
        patch: operations["patch_api_channels_by_channel_info"];
        trace?: never;
    };
    "/api/channels/{channel}/unread": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read your authorized channel unread count
         * @description Legacy/compatibility alias of /api/v1/channels/{channel}/unread. Pass the IRC channel name URL-encoded, e.g. %23general. Public history requires authentication. Secret/private/invite-only/keyed channels require authorized membership or a persistent founder grant; bans deny ordinary reads. Members can read retained history predating their join. Re-created channels receive a fresh generation; retained archives and old permissions remain inaccessible to the new generation. Legacy archives with residual active state cannot be reused. Restricted STATUSMSG/+U message bodies are excluded from general CHATHISTORY and REST history; eligible recipients can recover them through the authorized event journal within its retention window.
         */
        get: operations["get_api_channels_by_channel_unread"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/{username}/unread": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read your visible-channel unread summaries
         * @description Legacy/compatibility alias of /api/v1/users/{username}/unread. Self only; inaccessible channel names/counts are omitted. Read markers are updated through authenticated IRC MARKREAD.
         */
        get: operations["get_api_users_by_username_unread"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/media/upload": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Upload private or explicitly scoped media
         * @description Legacy/compatibility alias of /api/v1/media/upload. No scope means uploader-only. Requires a logged-in API session; nickname/Basic headers do not authenticate. The file limit defaults to 10 MiB and is configurable with FILEHOST_MAX_UPLOAD_BYTES; multipart framing has a separate 64 KiB allowance. Stored quota is 100 MiB per account. R2 is private and accessed only after persisted scope checks. Unowned legacy files are quarantined.
         */
        post: operations["post_api_media_upload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/webpush/subscribe": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Store your HTTPS push subscription
         * @description Legacy/compatibility alias of /api/v1/notifications/subscribe. Self only. Subscription persistence is implemented; encrypted WebPush delivery and configurable VAPID signing remain unimplemented.
         */
        post: operations["post_api_webpush_subscribe"];
        /**
         * Remove your push subscription
         * @description Legacy/compatibility alias of /api/v1/notifications/subscribe.
         */
        delete: operations["delete_api_webpush_subscribe"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/webpush/subscriptions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List your push subscription endpoints
         * @description Legacy/compatibility alias of /api/v1/notifications/subscriptions.
         */
        get: operations["get_api_webpush_subscriptions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/messages/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Search visible channel history
         * @description Legacy/compatibility alias of /api/v1/search. Explicit unauthorized channel scopes return 403. Broad searches omit inaccessible channels from results and the returned channel list. This endpoint does not search DMs.
         */
        get: operations["get_api_v1_messages_search"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Public health
         * @description Legacy/compatibility alias of /health.
         */
        get: operations["get_api_health"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Public status
         * @description Legacy/compatibility alias of /status.
         */
        get: operations["get_api_status"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/webhooks/{id}/{token}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Execute a channel-scoped webhook capability
         * @description Legacy/compatibility alias of /api/v1/webhooks/{token}. The path token is authentication for a narrowly scoped bot operation, not anonymous user access. Either content or embeds is required. The token must belong to the selected channel; archived channels revoke old hooks. IRC nicknames are namespaced as hook_* and the requested display name is a tag, never a registered account identity.
         */
        post: operations["post_api_v1_webhooks_by_id_by_token"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/webhooks/{id}/{token}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Execute a channel-scoped webhook capability
         * @description Legacy/compatibility alias of /api/v1/webhooks/{token}. The path token is authentication for a narrowly scoped bot operation, not anonymous user access. Either content or embeds is required. The token must belong to the selected channel; archived channels revoke old hooks. IRC nicknames are namespaced as hook_* and the requested display name is a tag, never a registered account identity.
         */
        post: operations["post_api_webhooks_by_id_by_token"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/conversations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List your direct conversations
         * @description Legacy/compatibility alias of /api/v1/conversations. Sorted by creation time and immutable ID. The after cursor must identify your own conversation. Continue with nextConversationId until null. Joined channels are returned separately by event bootstrap.
         */
        get: operations["get_api_conversations"];
        put?: never;
        /**
         * Resolve or create a direct conversation with an account
         * @description Legacy/compatibility alias of /api/v1/conversations. Requires current immutable account participation; administrator role alone grants no access. URL IDs select resources, never the authenticated sender. Optional senderId and recipientId selectors must be participants. clientOperationId uses epoch milliseconds followed by a dot and UUID, with a 24-hour retry window and five-minute future skew allowance. Identical retries return the original result; conflicting payloads return 409.
         */
        post: operations["post_api_conversations"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/conversations/{conversation}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read an authorized conversation
         * @description Legacy/compatibility alias of /api/v1/conversations/{conversation}. Requires current immutable account participation; administrator role alone grants no access. URL IDs select resources, never the authenticated sender. Optional senderId and recipientId selectors must be participants. clientOperationId uses epoch milliseconds followed by a dot and UUID, with a 24-hour retry window and five-minute future skew allowance. Identical retries return the original result; conflicting payloads return 409.
         */
        get: operations["get_api_conversations_by_conversation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/conversations/{conversation}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read participant-only canonical message history
         * @description Legacy/compatibility alias of /api/v1/conversations/{conversation}/messages. Requires current immutable account participation; administrator role alone grants no access. URL IDs select resources, never the authenticated sender. Optional senderId and recipientId selectors must be participants. clientOperationId uses epoch milliseconds followed by a dot and UUID, with a 24-hour retry window and five-minute future skew allowance. Identical retries return the original result; conflicting payloads return 409. before/after are message IDs in this conversation. Expired or absent references return a safe error. Messages are returned chronologically within the selected window. Redacted bodies are null; hasMore means another row matches the selected boundaries, not separate older/newer flags.
         */
        get: operations["get_api_conversations_by_conversation_messages"];
        put?: never;
        /**
         * Send a durable direct message
         * @description Legacy/compatibility alias of /api/v1/conversations/{conversation}/messages. Requires current immutable account participation; administrator role alone grants no access. URL IDs select resources, never the authenticated sender. Optional senderId and recipientId selectors must be participants. clientOperationId uses epoch milliseconds followed by a dot and UUID, with a 24-hour retry window and five-minute future skew allowance. Identical retries return the original result; conflicting payloads return 409.
         */
        post: operations["post_api_conversations_by_conversation_messages"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/conversations/{conversation}/messages/{message}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read a participant-only message by ID
         * @description Legacy/compatibility alias of /api/v1/conversations/{conversation}/messages/{message}. Requires current immutable account participation; administrator role alone grants no access. URL IDs select resources, never the authenticated sender. Optional senderId and recipientId selectors must be participants. clientOperationId uses epoch milliseconds followed by a dot and UUID, with a 24-hour retry window and five-minute future skew allowance. Identical retries return the original result; conflicting payloads return 409.
         */
        get: operations["get_api_conversations_by_conversation_messages_by_message"];
        put?: never;
        post?: never;
        /**
         * Redact your own direct message at its current revision
         * @description Legacy/compatibility alias of /api/v1/conversations/{conversation}/messages/{message}. Requires current immutable account participation; administrator role alone grants no access. URL IDs select resources, never the authenticated sender. Optional senderId and recipientId selectors must be participants. clientOperationId uses epoch milliseconds followed by a dot and UUID, with a 24-hour retry window and five-minute future skew allowance. Identical retries return the original result; conflicting payloads return 409.
         */
        delete: operations["delete_api_conversations_by_conversation_messages_by_message"];
        options?: never;
        head?: never;
        /**
         * Edit your own direct message at its current revision
         * @description Legacy/compatibility alias of /api/v1/conversations/{conversation}/messages/{message}. Requires current immutable account participation; administrator role alone grants no access. URL IDs select resources, never the authenticated sender. Optional senderId and recipientId selectors must be participants. clientOperationId uses epoch milliseconds followed by a dot and UUID, with a 24-hour retry window and five-minute future skew allowance. Identical retries return the original result; conflicting payloads return 409.
         */
        patch: operations["patch_api_conversations_by_conversation_messages_by_message"];
        trace?: never;
    };
    "/api/conversations/{conversation}/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Advance your durable read marker and notify your other clients
         * @description Legacy/compatibility alias of /api/v1/conversations/{conversation}/read. Requires current immutable account participation; administrator role alone grants no access. URL IDs select resources, never the authenticated sender. Optional senderId and recipientId selectors must be participants. clientOperationId uses epoch milliseconds followed by a dot and UUID, with a 24-hour retry window and five-minute future skew allowance. Identical retries return the original result; conflicting payloads return 409.
         */
        post: operations["post_api_conversations_by_conversation_read"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/conversations/{conversation}/unread": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read your conversation unread count
         * @description Legacy/compatibility alias of /api/v1/conversations/{conversation}/unread. Requires current immutable account participation; administrator role alone grants no access. URL IDs select resources, never the authenticated sender. Optional senderId and recipientId selectors must be participants. clientOperationId uses epoch milliseconds followed by a dot and UUID, with a 24-hour retry window and five-minute future skew allowance. Identical retries return the original result; conflicting payloads return 409.
         */
        get: operations["get_api_conversations_by_conversation_unread"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/conversations/{conversation}/attachments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List attachment metadata visible to a conversation participant
         * @description Legacy/compatibility alias of /api/v1/conversations/{conversation}/attachments. Requires current immutable account participation; administrator role alone grants no access. URL IDs select resources, never the authenticated sender. Optional senderId and recipientId selectors must be participants. clientOperationId uses epoch milliseconds followed by a dot and UUID, with a 24-hour retry window and five-minute future skew allowance. Identical retries return the original result; conflicting payloads return 409.
         */
        get: operations["get_api_conversations_by_conversation_attachments"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/dms/messages/{message}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Look up a direct message using authenticated participation
         * @description Legacy/compatibility alias of /api/v1/dms/messages/{message}. Requires current immutable account participation; administrator role alone grants no access. URL IDs select resources, never the authenticated sender. Optional senderId and recipientId selectors must be participants. clientOperationId uses epoch milliseconds followed by a dot and UUID, with a 24-hour retry window and five-minute future skew allowance. Identical retries return the original result; conflicting payloads return 409.
         */
        get: operations["get_api_dms_messages_by_message"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/metadata/{target}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read visible account metadata
         * @description Legacy/compatibility alias of /api/v1/metadata/{target}. Public custom metadata is visible to authenticated accounts. Keys prefixed private: are owner-only and require the credential's private-metadata scope. Administrator status does not grant private metadata publication.
         */
        get: operations["get_api_metadata_by_target"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Update or clear your own metadata with optional revision protection
         * @description Legacy/compatibility alias of /api/v1/metadata/{target}. value=null clears the key. expectedRevision conflicts return 409. Public and owner-only private: updates are delivered through separate authorized event audiences.
         */
        patch: operations["patch_api_metadata_by_target"];
        trace?: never;
    };
    "/api/events/replay": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Replay currently authorized durable changes after your cursor
         * @description Legacy/compatibility alias of /api/v1/events/replay. Cursors belong to an immutable account and grant no permissions. Replay checks original audience and current credentials, channel generation, participation and message redaction/expiry. A 410 CURSOR_EXPIRED requires bootstrap/resync. Replay never repeats mutations; de-duplicate eventId. An empty page may still advance cursor while filtering inaccessible events.
         */
        get: operations["get_api_events_replay"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/events/bootstrap": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read an initial account snapshot and recovery cursor
         * @description Legacy/compatibility alias of /api/v1/events/bootstrap. The initial recovery cursor precedes resource snapshot reads and is preserved across pages. Replay from it and de-duplicate event IDs, message IDs and resource revisions. Only currently authorized joined/persistent-membership channels are returned; bootstrap consumes no public-observer slots. Follow nextPageToken until channelsComplete; a page may contain no visible channels while scanning a bounded portion of the directory. Tokens are opaque, account-bound, capped at 64 per account and expire within 15 minutes or with the original recovery cursor, whichever is earlier. Foreign tokens return 403; expired tokens return 410 and require bootstrap/resync. Channel snapshots include metadata, recent history and read markers. This is not an atomic transaction across Durable Objects. Continue the conversation directory separately with nextConversationId.
         */
        get: operations["get_api_events_bootstrap"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/metrics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Authenticated Prometheus metrics */
        get: operations["get_metrics"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Error: {
            statusCode?: number;
            statusMessage?: string;
            message?: string;
            data?: {
                code?: string;
                message?: string;
                resync?: boolean;
            };
        };
        Ok: {
            /** @constant */
            ok: true;
        };
        Account: {
            id: string;
            username: string;
            displayName: string | null;
            roles: string[];
            createdAt: number;
            credentialVersion?: number;
        };
        Pagination: {
            count: number;
            limit: number;
            has_more: boolean;
            oldest_id: string | null;
            newest_id: string | null;
        };
        CredentialScope: {
            operation: string;
            resource: string;
        };
        AccountSession: {
            /** Format: uuid */
            id: string;
            /** @description Unix epoch milliseconds */
            createdAt: number;
            /** @description Unix epoch milliseconds */
            expiresAt: number;
            current: boolean;
            /** @enum {string} */
            kind: "session" | "integration";
            label: string | null;
            scopes: components["schemas"]["CredentialScope"][];
        };
        Message: {
            id: string;
            sequence: number;
            senderId: string;
            senderAccount: string | null;
            senderNick: string;
            senderUser: string;
            senderHost: string;
            command: string;
            content: string;
            tags?: {
                [key: string]: string | boolean;
            };
            multilineLines?: {
                content: string;
                concat: boolean;
            }[];
            redacted?: boolean;
            createdAt: number;
            expiresAt: number;
        };
        DirectMessage: {
            id: string;
            sequence: number;
            senderId: string;
            senderAccount: string | null;
            senderNick: string;
            targetNick: string;
            command: string;
            content: string;
            tags?: Record<string, never>;
            multilineLines?: {
                content: string;
                concat: boolean;
            }[];
            redacted: boolean;
            createdAt: number;
        };
        Role: {
            id: string;
            name: string;
            /** Format: uuid */
            parentId: string | null;
            color: string | null;
            ircMode: string | null;
            ircPrefix: string | null;
            priority: number;
            permissions: string[];
            createdAt: number;
            updatedAt: number;
        };
        Webhook: {
            id: string;
            name: string;
            token: string;
            avatar_url: string | null;
            created_by: string;
            created_at: number;
        };
        OutgoingWebhook: {
            id: string;
            target_url: string;
            events: string[];
            created_at: number;
        };
        Unread: {
            channel: string;
            username?: string | null;
            unreadCount: number;
            mentionCount: number;
            lastMessageId: string | null;
            lastMessageTime: number | null;
            lastReadTimestamp: string | null;
        };
        Profile: {
            username: string;
            displayName: string | null;
            avatar: string | null;
            pronouns: string | null;
            bio: string | null;
            bot: boolean;
            color: string | null;
            customStatus: string | null;
            timezone: string | null;
            roles: string[];
            createdAt: number;
            /** @default 0 */
            revision: number;
        };
        Channel: {
            channel: string;
            /** Format: uuid */
            generation: string;
            canonicalName: string;
            topic: string | null;
            topicSetBy: string | null;
            topicSetAt: number | null;
            modes: string;
            registered: boolean;
            founder: string | null;
            registeredAt: number | null;
            avatar: string | null;
            description: string | null;
            category: string | null;
            /** @default [] */
            tags: string[];
            /** @default false */
            nsfw: boolean;
            color: string | null;
            readOnly: boolean;
            memberCount: number;
            createdAt: number;
        };
        RealtimeEvent: {
            /** @constant */
            type: "message.created";
            eventId: string;
            channelId?: string;
            channelGeneration?: string;
            conversationId?: string;
            profileAccountId?: string;
            ownerId?: string;
            operationId?: string;
            messageId?: string;
            senderId?: string;
            sequence?: number;
            timestamp: string;
            data: components["schemas"]["EventData_message_created"];
        } | {
            /** @constant */
            type: "message.updated";
            eventId: string;
            channelId?: string;
            channelGeneration?: string;
            conversationId?: string;
            profileAccountId?: string;
            ownerId?: string;
            operationId?: string;
            messageId?: string;
            senderId?: string;
            sequence?: number;
            timestamp: string;
            data: components["schemas"]["EventData_message_updated"];
        } | {
            /** @constant */
            type: "message.deleted";
            eventId: string;
            channelId?: string;
            channelGeneration?: string;
            conversationId?: string;
            profileAccountId?: string;
            ownerId?: string;
            operationId?: string;
            messageId?: string;
            senderId?: string;
            sequence?: number;
            timestamp: string;
            data: components["schemas"]["EventData_message_deleted"];
        } | {
            /** @constant */
            type: "channel.created";
            eventId: string;
            channelId?: string;
            channelGeneration?: string;
            conversationId?: string;
            profileAccountId?: string;
            ownerId?: string;
            operationId?: string;
            messageId?: string;
            senderId?: string;
            sequence?: number;
            timestamp: string;
            data: components["schemas"]["EventData_channel_created"];
        } | {
            /** @constant */
            type: "channel.updated";
            eventId: string;
            channelId?: string;
            channelGeneration?: string;
            conversationId?: string;
            profileAccountId?: string;
            ownerId?: string;
            operationId?: string;
            messageId?: string;
            senderId?: string;
            sequence?: number;
            timestamp: string;
            /** @description Legacy event kind without a current typed producer contract; do not infer fields. */
            data: {
                [key: string]: unknown;
            };
        } | {
            /** @constant */
            type: "channel.deleted";
            eventId: string;
            channelId?: string;
            channelGeneration?: string;
            conversationId?: string;
            profileAccountId?: string;
            ownerId?: string;
            operationId?: string;
            messageId?: string;
            senderId?: string;
            sequence?: number;
            timestamp: string;
            data: components["schemas"]["EventData_channel_deleted"];
        } | {
            /** @constant */
            type: "channel.member_joined";
            eventId: string;
            channelId?: string;
            channelGeneration?: string;
            conversationId?: string;
            profileAccountId?: string;
            ownerId?: string;
            operationId?: string;
            messageId?: string;
            senderId?: string;
            sequence?: number;
            timestamp: string;
            data: components["schemas"]["EventData_channel_member_joined"];
        } | {
            /** @constant */
            type: "channel.member_left";
            eventId: string;
            channelId?: string;
            channelGeneration?: string;
            conversationId?: string;
            profileAccountId?: string;
            ownerId?: string;
            operationId?: string;
            messageId?: string;
            senderId?: string;
            sequence?: number;
            timestamp: string;
            data: components["schemas"]["EventData_channel_member_left"];
        } | {
            /** @constant */
            type: "channel.topic_changed";
            eventId: string;
            channelId?: string;
            channelGeneration?: string;
            conversationId?: string;
            profileAccountId?: string;
            ownerId?: string;
            operationId?: string;
            messageId?: string;
            senderId?: string;
            sequence?: number;
            timestamp: string;
            data: components["schemas"]["EventData_channel_topic_changed"];
        } | {
            /** @constant */
            type: "channel.metadata_updated";
            eventId: string;
            channelId?: string;
            channelGeneration?: string;
            conversationId?: string;
            profileAccountId?: string;
            ownerId?: string;
            operationId?: string;
            messageId?: string;
            senderId?: string;
            sequence?: number;
            timestamp: string;
            /** @description Legacy event kind without a current typed producer contract; do not infer fields. */
            data: {
                [key: string]: unknown;
            };
        } | {
            /** @constant */
            type: "channel.role_created";
            eventId: string;
            channelId?: string;
            channelGeneration?: string;
            conversationId?: string;
            profileAccountId?: string;
            ownerId?: string;
            operationId?: string;
            messageId?: string;
            senderId?: string;
            sequence?: number;
            timestamp: string;
            data: components["schemas"]["EventData_channel_role_created"];
        } | {
            /** @constant */
            type: "channel.role_updated";
            eventId: string;
            channelId?: string;
            channelGeneration?: string;
            conversationId?: string;
            profileAccountId?: string;
            ownerId?: string;
            operationId?: string;
            messageId?: string;
            senderId?: string;
            sequence?: number;
            timestamp: string;
            data: components["schemas"]["EventData_channel_role_updated"];
        } | {
            /** @constant */
            type: "channel.role_deleted";
            eventId: string;
            channelId?: string;
            channelGeneration?: string;
            conversationId?: string;
            profileAccountId?: string;
            ownerId?: string;
            operationId?: string;
            messageId?: string;
            senderId?: string;
            sequence?: number;
            timestamp: string;
            data: components["schemas"]["EventData_channel_role_deleted"];
        } | {
            /** @constant */
            type: "channel.member_role_changed";
            eventId: string;
            channelId?: string;
            channelGeneration?: string;
            conversationId?: string;
            profileAccountId?: string;
            ownerId?: string;
            operationId?: string;
            messageId?: string;
            senderId?: string;
            sequence?: number;
            timestamp: string;
            data: components["schemas"]["EventData_channel_member_role_changed"];
        } | {
            /** @constant */
            type: "auth.registered";
            eventId: string;
            channelId?: string;
            channelGeneration?: string;
            conversationId?: string;
            profileAccountId?: string;
            ownerId?: string;
            operationId?: string;
            messageId?: string;
            senderId?: string;
            sequence?: number;
            timestamp: string;
            /** @description Legacy event kind without a current typed producer contract; do not infer fields. */
            data: {
                [key: string]: unknown;
            };
        } | {
            /** @constant */
            type: "auth.logged_in";
            eventId: string;
            channelId?: string;
            channelGeneration?: string;
            conversationId?: string;
            profileAccountId?: string;
            ownerId?: string;
            operationId?: string;
            messageId?: string;
            senderId?: string;
            sequence?: number;
            timestamp: string;
            /** @description Legacy event kind without a current typed producer contract; do not infer fields. */
            data: {
                [key: string]: unknown;
            };
        } | {
            /** @constant */
            type: "user.profile_updated";
            eventId: string;
            channelId?: string;
            channelGeneration?: string;
            conversationId?: string;
            profileAccountId?: string;
            ownerId?: string;
            operationId?: string;
            messageId?: string;
            senderId?: string;
            sequence?: number;
            timestamp: string;
            data: components["schemas"]["EventData_user_profile_updated"];
        } | {
            /** @constant */
            type: "unread.updated";
            eventId: string;
            channelId?: string;
            channelGeneration?: string;
            conversationId?: string;
            profileAccountId?: string;
            ownerId?: string;
            operationId?: string;
            messageId?: string;
            senderId?: string;
            sequence?: number;
            timestamp: string;
            /** @description Legacy event kind without a current typed producer contract; do not infer fields. */
            data: {
                [key: string]: unknown;
            };
        } | {
            /** @constant */
            type: "conversation.created";
            eventId: string;
            channelId?: string;
            channelGeneration?: string;
            conversationId?: string;
            profileAccountId?: string;
            ownerId?: string;
            operationId?: string;
            messageId?: string;
            senderId?: string;
            sequence?: number;
            timestamp: string;
            data: components["schemas"]["EventData_conversation_created"];
        } | {
            /** @constant */
            type: "conversation.message_created";
            eventId: string;
            channelId?: string;
            channelGeneration?: string;
            conversationId?: string;
            profileAccountId?: string;
            ownerId?: string;
            operationId?: string;
            messageId?: string;
            senderId?: string;
            sequence?: number;
            timestamp: string;
            data: components["schemas"]["EventData_conversation_message_created"];
        } | {
            /** @constant */
            type: "conversation.message_updated";
            eventId: string;
            channelId?: string;
            channelGeneration?: string;
            conversationId?: string;
            profileAccountId?: string;
            ownerId?: string;
            operationId?: string;
            messageId?: string;
            senderId?: string;
            sequence?: number;
            timestamp: string;
            data: components["schemas"]["EventData_conversation_message_updated"];
        } | {
            /** @constant */
            type: "conversation.message_redacted";
            eventId: string;
            channelId?: string;
            channelGeneration?: string;
            conversationId?: string;
            profileAccountId?: string;
            ownerId?: string;
            operationId?: string;
            messageId?: string;
            senderId?: string;
            sequence?: number;
            timestamp: string;
            data: components["schemas"]["EventData_conversation_message_redacted"];
        } | {
            /** @constant */
            type: "conversation.read";
            eventId: string;
            channelId?: string;
            channelGeneration?: string;
            conversationId?: string;
            profileAccountId?: string;
            ownerId?: string;
            operationId?: string;
            messageId?: string;
            senderId?: string;
            sequence?: number;
            timestamp: string;
            data: components["schemas"]["EventData_conversation_read"];
        } | {
            /** @constant */
            type: "user.metadata_updated";
            eventId: string;
            channelId?: string;
            channelGeneration?: string;
            conversationId?: string;
            profileAccountId?: string;
            ownerId?: string;
            operationId?: string;
            messageId?: string;
            senderId?: string;
            sequence?: number;
            timestamp: string;
            data: components["schemas"]["EventData_user_metadata_updated"];
        } | {
            /** @constant */
            type: "channel.invited";
            eventId: string;
            channelId?: string;
            channelGeneration?: string;
            conversationId?: string;
            profileAccountId?: string;
            ownerId?: string;
            operationId?: string;
            messageId?: string;
            senderId?: string;
            sequence?: number;
            timestamp: string;
            data: components["schemas"]["EventData_channel_invited"];
        };
        EventData_message_created: {
            id: string;
            senderId: string;
            senderAccount?: string | null;
            senderNick: string;
            content: string;
            tags: {
                [key: string]: string | true;
            };
            createdAt: number;
            sequence?: number;
            command?: string;
            expiresAt?: number;
        } & {
            [key: string]: unknown;
        };
        EventData_message_updated: {
            channel: string;
            messageId: string;
            newContent: string;
            editor: string;
            editMessageId: string;
        } & {
            [key: string]: unknown;
        };
        EventData_message_deleted: {
            id: string;
            operationId?: string;
        } & {
            [key: string]: unknown;
        };
        EventData_channel_created: {
            channel: string;
            generation: string;
            revision: number;
            /** @enum {string} */
            privacy: "public" | "secret";
        };
        EventData_channel_deleted: {
            channel: string;
            previousGeneration: string;
            generation: string;
            revision?: number;
            /** @constant */
            resync: true;
        };
        EventData_channel_member_joined: {
            accountId: string;
            joined: boolean;
            generation: string;
            revision: number;
        };
        EventData_channel_member_left: {
            accountId: string;
            joined: boolean;
            generation: string;
            revision: number;
        };
        EventData_channel_topic_changed: {
            topic: string | null;
            setBy: string;
        } & {
            [key: string]: unknown;
        };
        EventData_channel_role_created: {
            roleGroupId: string;
            channel?: string;
            name?: string;
            ircMode?: string | null;
        } & {
            [key: string]: unknown;
        };
        EventData_channel_role_updated: {
            roleGroupId: string;
            channel?: string;
            name?: string;
            ircMode?: string | null;
        } & {
            [key: string]: unknown;
        };
        EventData_channel_role_deleted: {
            roleGroupId: string;
            channel?: string;
            name?: string;
            ircMode?: string | null;
        } & {
            [key: string]: unknown;
        };
        EventData_channel_member_role_changed: {
            userId: string;
            roleGroupId: string;
            assigned: boolean;
        } & {
            [key: string]: unknown;
        };
        EventData_user_profile_updated: {
            accountId: string;
            profile: {
                username: string;
                displayName: string | null;
                avatar: string | null;
                pronouns: string | null;
                bio: string | null;
                bot: boolean;
                color: string | null;
                customStatus: string | null;
                timezone: string | null;
                roles: string[];
                createdAt: number;
                /** @default 0 */
                revision: number;
            };
            revision: number;
            metadata: {
                [key: string]: string | null;
            };
        };
        EventData_conversation_created: {
            id: string;
            /** @constant */
            kind: "direct";
            participantIds: string[];
            revision: number;
        };
        EventData_conversation_message_created: {
            id: string;
            conversationId: string;
            senderId: string;
            senderAccount: string | null;
            senderNick: string;
            recipientId: string | null;
            content: string | null;
            redacted: boolean;
            tags: {
                [key: string]: string | true;
            };
            revision: number;
            sequence: number;
            createdAt: number;
            updatedAt: number;
        };
        EventData_conversation_message_updated: {
            id: string;
            conversationId: string;
            senderId: string;
            senderAccount: string | null;
            senderNick: string;
            recipientId: string | null;
            content: string | null;
            redacted: boolean;
            tags: {
                [key: string]: string | true;
            };
            revision: number;
            sequence: number;
            createdAt: number;
            updatedAt: number;
        };
        EventData_conversation_message_redacted: {
            id: string;
            conversationId: string;
            senderId: string;
            senderAccount: string | null;
            senderNick: string;
            recipientId: string | null;
            content: string | null;
            redacted: boolean;
            tags: {
                [key: string]: string | true;
            };
            revision: number;
            sequence: number;
            createdAt: number;
            updatedAt: number;
        };
        EventData_conversation_read: {
            conversationId: string;
            messageId: string;
            unread: number;
        };
        EventData_user_metadata_updated: {
            accountId: string;
            username: string;
            revision: number;
            metadata: {
                [key: string]: string | null;
            };
        };
        EventData_channel_invited: {
            channel: string;
            generation: string;
            invited: boolean;
            actorId: string;
            targetAccountId: string;
        };
        EventCommand: {
            /** @constant */
            type: "subscribe";
            requestId?: string;
            resources: {
                channels?: {
                    channel: string;
                    generation: string;
                }[];
                conversations?: string[];
                profiles?: string[];
            };
            cursor?: string;
        } | {
            /** @constant */
            type: "replay";
            requestId?: string;
            cursor: string;
            limit?: number;
        } | {
            /** @constant */
            type: "mutate";
            requestId: string;
            /** @enum {string} */
            operation: "conversation.send" | "conversation.edit" | "conversation.redact" | "conversation.read" | "profile.update" | "metadata.update" | "channel.create" | "channel.join" | "channel.leave" | "channel.invite" | "channel.uninvite" | "channel.delete" | "channel.send" | "channel.edit" | "channel.redact" | "channel.bulk.redact" | "channel.topic" | "channel.role.create" | "channel.role.update" | "channel.role.delete" | "channel.role.assign" | "channel.role.remove";
            input: {
                [key: string]: unknown;
            };
        } | {
            /** @constant */
            type: "bootstrap";
            requestId?: string;
            pageToken?: string;
        };
        EventStreamHello: {
            /** @constant */
            type: "hello";
            /** @constant */
            protocol: 2;
            ack: {
                /** @constant */
                type: "reader.ack";
                /** @constant */
                maxBytes: 262144;
                /** @constant */
                maxFrames: 1024;
                /** @constant */
                maxAgeMs: 30000;
            };
        };
        ReaderChallenge: {
            /** @constant */
            type: "reader.challenge";
            token: string;
        };
        ReaderAck: {
            /** @constant */
            type: "reader.ack";
            token: string;
        };
        EventSubscriptions: {
            channels?: {
                channel: string;
                generation: string;
            }[];
            conversations?: string[];
            profiles?: string[];
        };
        ConversationMessage: {
            id: string;
            conversationId: string;
            senderId: string;
            senderAccount: string | null;
            senderNick: string;
            recipientId: string | null;
            content: string | null;
            redacted: boolean;
            tags: {
                [key: string]: string | true;
            };
            revision: number;
            sequence: number;
            createdAt: number;
            updatedAt: number;
        };
        Conversation: {
            /** Format: uuid */
            id: string;
            /** @constant */
            kind: "direct";
            participantIds: string[];
            revision: number;
            /** @description Unix epoch milliseconds */
            createdAt: number;
            unread: number;
        };
        RegisterRequest: {
            username: string;
            password: string;
            displayName?: string;
        };
        LoginRequest: {
            username: string;
            password: string;
        };
        UpdateProfile: {
            displayName?: string | null;
            avatar?: string | null;
            pronouns?: string | null;
            bio?: string | null;
            bot?: boolean | string | null;
            color?: string | null;
            customStatus?: string | null;
            timezone?: string | null;
            expectedRevision?: number;
            clientOperationId?: string;
        };
        CreateConversation: {
            peer: string;
            clientOperationId: string;
        };
        SendConversationMessage: {
            /** Format: uuid */
            senderId?: string;
            /** Format: uuid */
            recipientId?: string;
            content: string;
            tags?: {
                [key: string]: string | true;
            };
            clientOperationId: string;
        };
        EditConversationMessage: {
            content: string;
            expectedRevision: number;
            clientOperationId: string;
        };
        RedactConversationMessage: {
            expectedRevision: number;
            clientOperationId: string;
        };
        ReadConversation: {
            messageId: string;
            clientOperationId: string;
        };
        UpdateMetadata: {
            key: string;
            value: string | null;
            expectedRevision?: number;
            clientOperationId?: string;
        };
        CreateChannel: {
            name: string;
            /**
             * @default secret
             * @enum {string}
             */
            privacy: "public" | "secret";
            /** @default false */
            inviteOnly: boolean;
            key?: string;
            /** @default false */
            registeredOnly: boolean;
            /** @default false */
            moderated: boolean;
            /** @default false */
            readOnly: boolean;
        };
        UpdateChannel: {
            avatar?: string | null;
            description?: string | null;
            category?: string | null;
            tags?: string[];
            nsfw?: boolean | string;
            color?: string | null;
            readOnly?: boolean | string | null;
            topic?: string | null;
        };
        SendMessage: {
            content: string;
            senderNick?: string;
            replyToMessageId?: string;
            tags?: {
                [key: string]: string | boolean;
            };
        };
        EditMessage: {
            content: string;
            senderNick?: string;
        };
        SearchResult: {
            /** @constant */
            ok: true;
            channels?: string[];
            channel?: string;
            query: string;
            filters: Record<string, never>;
            count: number;
            items: {
                message: Record<string, never>;
                conversation: Record<string, never>;
            }[];
            nextCursor: string | null;
            messages: components["schemas"]["Message"][];
        };
        CreateRole: {
            name: string;
            parentId?: string | null;
            color?: string | null;
            ircPrefix?: ("~" | "&" | "@" | "%" | "+") | null;
            ircMode?: ("q" | "a" | "o" | "h" | "v") | null;
            /** @default 0 */
            priority: number;
            /** @default [] */
            permissions: ("send_messages" | "change_topic" | "kick_members" | "ban_members" | "attach_files" | "manage_channel")[];
        };
        UpdateRole: {
            name?: string;
            parentId?: string | null;
            color?: string | null;
            ircPrefix?: ("~" | "&" | "@" | "%" | "+") | null;
            ircMode?: ("q" | "a" | "o" | "h" | "v") | null;
            /** @default 0 */
            priority: number;
            /** @default [] */
            permissions: ("send_messages" | "change_topic" | "kick_members" | "ban_members" | "attach_files" | "manage_channel")[];
        };
        AssignRole: {
            /** Format: uuid */
            userId: string;
            /** Format: uuid */
            roleGroupId: string;
            remove?: boolean;
        };
        Subscribe: {
            username: string;
            /** Format: uri */
            endpoint: string;
            keys?: {
                p256dh?: string;
                auth?: string;
            };
        };
        Upload: {
            /** @constant */
            ok: true;
            id: string;
            url: string;
            filename: string;
            size: number;
            mimeType: string;
            uploader: string;
        };
        AdminResult: {
            ok: boolean;
            channelName?: string;
            message?: string;
            error?: string;
            recipientSessionIds?: string[];
        };
        Admin_post__config: {
            filehostEnabled?: boolean;
            filehostRequireRegistration?: boolean;
            zncMaxMessages?: number;
            /** @enum {string} */
            signupPolicy?: "open" | "closed" | "invite";
            minPasswordLength?: number;
        };
        Admin_post__broadcast: {
            message: string;
            sender?: string;
            notice?: boolean;
            wallops?: boolean;
        };
        Admin_post__sessions_disconnect: {
            sessionId?: string;
            nickname?: string;
            reason?: string;
        };
        Admin_post__accounts: {
            username: string;
            password: string;
            displayName?: string;
            roles?: string[];
        };
        Admin_post__accounts_disable: {
            username: string;
        };
        Admin_patch__accounts__username_: {
            displayName?: string | null;
            roles?: string[];
        };
        Admin_post__accounts__username__password: {
            password: string;
        };
        Admin_post__accounts__username__roles: {
            role: string;
            /**
             * @default grant
             * @enum {string}
             */
            action: "grant" | "revoke";
        };
        Admin_patch__profile__username_: {
            displayName?: string | null;
            avatar?: string | null;
            pronouns?: string | null;
            bio?: string | null;
            bot?: boolean | string | null;
            color?: string | null;
            customStatus?: string | null;
            timezone?: string | null;
        };
        Admin_post__messages_redact: {
            channel: string;
            msgId: string;
            reason?: string;
        };
        Admin_delete__channels__channel_: {
            purgeMessages: boolean;
        };
        Admin_patch__channels__channel__info: {
            avatar?: string | null;
            description?: string | null;
            category?: string | null;
            tags?: string[];
            nsfw?: boolean | string;
            color?: string | null;
            readOnly?: boolean | string | null;
            topic?: string | null;
        };
        Admin_post__channels__channel__register: {
            founder?: string;
        };
        Admin_post__channels__channel__modes: {
            modeString: string;
            /** @default [] */
            modeArgs: string[];
        };
        Admin_post__channels__channel__topic: {
            topic: string;
            setBy?: string;
        };
        Admin_post__channels__channel__kick: {
            nickname: string;
            reason?: string;
        };
        Admin_post__channels__channel__bot: {
            enabled?: boolean;
            welcomeMessage?: string | null;
        };
        Admin_post__channels__channel__messages_purge: {
            all?: boolean;
            beforeTimestamp?: number;
            beforeMsgId?: string;
        };
        Admin_put__metadata_users__target_: {
            key?: string;
            value?: string | null;
            entries?: {
                [key: string]: string | null;
            };
        };
        Admin_put__metadata_channels__target_: {
            key?: string;
            value?: string | null;
            entries?: {
                [key: string]: string | null;
            };
        };
        Admin_put__accounts__username__scopes: {
            scopes: {
                operation: string;
                resource: string;
            }[];
        };
        Admin_post__bans: {
            /** @enum {string} */
            kind: "account" | "hostmask";
            value: string;
            expiresAt?: number | null;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    get_health: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok: boolean;
                        service: string;
                        network: string;
                        server: string;
                        version: string;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_status: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok: boolean;
                        status: string;
                        service: string;
                        network: string;
                        server: string;
                        version: string;
                        time: string;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_auth_register: {
        parameters: {
            query?: never;
            header?: {
                /** @description Shared invite code when signup policy is invite */
                "X-Signup-Token"?: string;
                /** @description One-time bootstrap of a reserved ADMIN_USERS account before any administrator has been provisioned */
                "X-Bootstrap-Token"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RegisterRequest"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        account: components["schemas"]["Account"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_auth_login: {
        parameters: {
            query?: never;
            header?: {
                /** @description Opt in to the secure HttpOnly cookie; omit for a bearer token */
                "X-FlaRC-Session"?: "cookie";
                /** @description Required and checked against configured origins for cookie login */
                Origin?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginRequest"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        account: components["schemas"]["Account"];
                        token: string;
                        /** @description Unix epoch milliseconds */
                        expiresAt: number;
                    } | {
                        /** @constant */
                        ok: true;
                        account: components["schemas"]["Account"];
                        csrfToken: string;
                        /** @description Unix epoch milliseconds */
                        expiresAt: number;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Invalid credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Cookie login Origin denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_auth_sessions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        sessions: components["schemas"]["AccountSession"][];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_api_v1_auth_sessions_by_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Ok"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_auth_credentials: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    label: string;
                    /** @description Unix epoch milliseconds */
                    expiresAt: number;
                    scopes: components["schemas"]["CredentialScope"][];
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        credential: {
                            id: string;
                            token: string;
                            /** @description Unix epoch milliseconds */
                            expiresAt: number;
                        };
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_auth_logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Ok"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_auth_events_ticket: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        ticket: string;
                        /** @constant */
                        expiresIn: 30;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_events: {
        parameters: {
            query?: {
                /** @description Single-use ticket from POST /api/v1/auth/events-ticket */
                ticket?: string;
            };
            header?: {
                /** @description Negotiate version 2 for sustained streaming with reader.challenge/reader.ack flow control */
                "Sec-WebSocket-Protocol"?: "flarc.events.v2";
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description WebSocket upgraded; server frames contain RealtimeEvent payloads or command result/error control envelopes */
            101: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Invalid session/ticket */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Origin denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description WebSocket upgrade required */
            426: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Connection/subscription budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_profiles_by_username: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        profile: components["schemas"]["Profile"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patch_api_v1_profiles_by_username: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateProfile"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        profile: components["schemas"]["Profile"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_conversations: {
        parameters: {
            query?: {
                limit?: number;
                after?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        conversations: components["schemas"]["Conversation"][];
                        nextConversationId: string | null;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_conversations: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateConversation"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        conversation: components["schemas"]["Conversation"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_conversations_by_conversation: {
        parameters: {
            query?: {
                senderId?: string;
                recipientId?: string;
            };
            header?: never;
            path: {
                conversation: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        conversation: components["schemas"]["Conversation"];
                        unread: number;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_conversations_by_conversation_messages: {
        parameters: {
            query?: {
                senderId?: string;
                recipientId?: string;
                limit?: number;
                before?: string;
                after?: string;
            };
            header?: never;
            path: {
                conversation: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        messages: components["schemas"]["ConversationMessage"][];
                        hasMore: boolean;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_conversations_by_conversation_messages: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                conversation: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SendConversationMessage"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        message: components["schemas"]["ConversationMessage"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_conversations_by_conversation_messages_by_message: {
        parameters: {
            query?: {
                senderId?: string;
                recipientId?: string;
            };
            header?: never;
            path: {
                conversation: string;
                message: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        message: components["schemas"]["ConversationMessage"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_api_v1_conversations_by_conversation_messages_by_message: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                conversation: string;
                message: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RedactConversationMessage"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        message: components["schemas"]["ConversationMessage"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patch_api_v1_conversations_by_conversation_messages_by_message: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                conversation: string;
                message: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EditConversationMessage"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        message: components["schemas"]["ConversationMessage"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_conversations_by_conversation_read: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                conversation: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReadConversation"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        conversationId: string;
                        messageId: string;
                        unread: number;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_conversations_by_conversation_unread: {
        parameters: {
            query?: {
                senderId?: string;
                recipientId?: string;
            };
            header?: never;
            path: {
                conversation: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        conversationId: string;
                        unread: number;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_conversations_by_conversation_attachments: {
        parameters: {
            query?: {
                senderId?: string;
                recipientId?: string;
            };
            header?: never;
            path: {
                conversation: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        attachments: {
                            id: string;
                            filename: string;
                            mimeType: string;
                            size: number;
                            /** @description Unix epoch milliseconds */
                            createdAt: number;
                        }[];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_dms_messages_by_message: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                message: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        message: components["schemas"]["ConversationMessage"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_metadata_by_target: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                target: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        metadata: {
                            [key: string]: string | null;
                        };
                        revision: number;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patch_api_v1_metadata_by_target: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                target: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateMetadata"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        result: {
                            key: string;
                            value: string | null;
                            username: string;
                        };
                        revision: number;
                        replayed: boolean;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_events_replay: {
        parameters: {
            query: {
                cursor: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        events: (components["schemas"]["RealtimeEvent"] & {
                            cursor: string;
                        })[];
                        cursor: string;
                        caughtUp: boolean;
                        /** @constant */
                        readOnly: true;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description CURSOR_EXPIRED: obtain a new bootstrap snapshot and reconcile state */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_events_bootstrap: {
        parameters: {
            query?: {
                /** @description Opaque account-bound continuation token from nextPageToken; never a channel name */
                pageToken?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        cursor: string;
                        conversations: components["schemas"]["Conversation"][];
                        nextConversationId: string | null;
                        channelsComplete: boolean;
                        nextPageToken: string | null;
                        channels: {
                            channel: string;
                            /** Format: uuid */
                            generation: string;
                            canRead: boolean;
                            canWrite: boolean;
                            isMember: boolean;
                            memberModes: string;
                            revision: number;
                            info: components["schemas"]["Channel"];
                            history: components["schemas"]["Message"][] | null;
                            readMarker: string | null;
                            eventBoundary: {
                                /** @constant */
                                kind: "membership";
                                generation: string;
                                revision: number;
                            };
                        }[];
                        profile: components["schemas"]["Profile"] | null;
                        recovery: {
                            /** @constant */
                            mode: "cursor-before-snapshot";
                            interestBoundary: string;
                            replayFrom: string;
                            deduplicateBy: string[];
                            /** @constant */
                            crossObjectAtomic: false;
                        };
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Bootstrap page or original recovery cursor expired; restart bootstrap/resync */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_channels: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channels: {
                            channelName: string;
                            canonicalName: string;
                            activeMemberCount: number;
                        }[];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_channels: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateChannel"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channel: string;
                        /** Format: uuid */
                        generation: string;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_channels_by_channel_join: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    key?: string;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channel: string;
                        /** Format: uuid */
                        generation: string;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_channels_by_channel_leave: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channel: string;
                        /** Format: uuid */
                        generation: string;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_channels_by_channel_members: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channel: string;
                        /** Format: uuid */
                        generation: string;
                        members: {
                            userId: string;
                            username: string;
                            origins: string[];
                            modes: string;
                        }[];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_channels_by_channel_invites: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    username: string;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channel: string;
                        /** Format: uuid */
                        generation: string;
                        username: string;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_api_v1_channels_by_channel_invites_by_username: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
                username: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channel: string;
                        /** Format: uuid */
                        generation: string;
                        username: string;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_api_v1_channels_by_channel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    purge?: boolean;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channel: string;
                        /** Format: uuid */
                        generation: string;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_channels_by_channel_messages_bulk_redact: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    ids: string[];
                    operationId: string;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        ids: string[];
                        operationId: string;
                        /** Format: uuid */
                        generation: string;
                        replayed: boolean;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_channels_by_channel_info: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channel: components["schemas"]["Channel"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patch_api_v1_channels_by_channel_info: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateChannel"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channel: components["schemas"]["Channel"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_channels_by_channel_messages: {
        parameters: {
            query?: {
                limit?: number;
                /** @description Message ID or timestamp, within this conversation */
                before?: string;
                after?: string;
                around?: string;
            };
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channel: string;
                        messages: components["schemas"]["Message"][];
                        pagination: components["schemas"]["Pagination"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_channels_by_channel_messages: {
        parameters: {
            query?: never;
            header?: {
                /** @description Retries with the same account/channel/key reuse the committed message; a different payload is rejected */
                "Idempotency-Key"?: string;
            };
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SendMessage"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        message: components["schemas"]["Message"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_api_v1_channels_by_channel_messages_by_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        id: string;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patch_api_v1_channels_by_channel_messages_by_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EditMessage"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        message: {
                            id: string;
                            content: string;
                            tags: Record<string, never>;
                            editedAt: number;
                        };
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_channels_by_channel_messages_search: {
        parameters: {
            query?: {
                /** @description Search text with inline in:/from:/has:/tag: filters */
                q?: string;
                limit?: number;
                from?: string | string[];
                mentions?: string | string[];
                has?: string | string[];
                tag?: string | string[];
                sender?: string;
                before?: string;
                after?: string;
                on?: string;
                author?: string;
                pinned?: string;
                cursor?: string;
            };
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SearchResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_search: {
        parameters: {
            query?: {
                /** @description Search text with inline in:/from:/has:/tag: filters */
                q?: string;
                limit?: number;
                from?: string | string[];
                mentions?: string | string[];
                has?: string | string[];
                tag?: string | string[];
                sender?: string;
                before?: string;
                after?: string;
                on?: string;
                author?: string;
                pinned?: string;
                cursor?: string;
                in?: string | string[];
                conversationId?: string | string[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SearchResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_dms_by_target_messages: {
        parameters: {
            query?: {
                limit?: number;
                /** @description Message ID or timestamp, within this conversation */
                before?: string;
                after?: string;
                /** @description Defaults to the authenticated account; caller must be one of the selected pair */
                user?: string;
            };
            header?: never;
            path: {
                target: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        user: string;
                        target: string;
                        messages: components["schemas"]["DirectMessage"][];
                        pagination: components["schemas"]["Pagination"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_channels_by_channel_roles: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        roles: components["schemas"]["Role"][];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_channels_by_channel_roles: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateRole"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        role: components["schemas"]["Role"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_api_v1_channels_by_channel_roles_by_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok: boolean;
                        id: string;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patch_api_v1_channels_by_channel_roles_by_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateRole"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        role: components["schemas"]["Role"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_channels_by_channel_roles_assign: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssignRole"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        userId: string;
                        roleGroupId: string;
                        assigned: boolean;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_channels_by_channel_unread: {
        parameters: {
            query?: {
                /** @description Defaults to caller; must identify the caller */
                username?: string;
                /** @description Legacy username alias */
                user?: string;
            };
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Unread"] & {
                        /** @constant */
                        ok: true;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_users_by_username_unread: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        username: string;
                        channels: components["schemas"]["Unread"][];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_users_by_username_notifications: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        username: string;
                        notifications: {
                            channel: string;
                            /** @enum {string} */
                            level: "all" | "mentions" | "nothing";
                            muted: boolean;
                            mutedUntil: number | null;
                        }[];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    put_api_v1_users_by_username_notifications_by_channel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
                channel: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    level: "all" | "mentions" | "nothing";
                    muted_until?: number | null;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        username: string;
                        channel: string;
                        /** @enum {string} */
                        level: "all" | "mentions" | "nothing";
                        mutedUntil: number | null;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_notifications_subscribe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Subscribe"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        registered: boolean;
                        endpoint: string;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_api_v1_notifications_subscribe: {
        parameters: {
            query?: {
                username?: string;
                endpoint?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        removed: boolean;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_notifications_subscriptions: {
        parameters: {
            query?: {
                username?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        username: string;
                        endpoints: string[];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_media_upload: {
        parameters: {
            query?: {
                /** @description Explicit channel scope; caller must be an authorized member */
                channel?: string;
                /** @description Explicit recipient account; both accounts can read */
                dm?: string;
            };
            header?: {
                "X-Filename"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": {
                    /** Format: binary */
                    file: string;
                };
                "application/octet-stream": string;
                "image/png": string;
                "text/plain": string;
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Upload"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_media_by_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Authorized file bytes */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_api_v1_media_by_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Ok"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_embeds: {
        parameters: {
            query?: {
                url?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        embed: Record<string, never>;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_channels_by_channel_webhooks: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channel: string;
                        webhooks: components["schemas"]["Webhook"][];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_channels_by_channel_webhooks: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    /** Format: uri */
                    avatar_url?: string;
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        webhook: components["schemas"]["Webhook"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_api_v1_channels_by_channel_webhooks_by_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Ok"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_webhooks_by_token: {
        parameters: {
            query?: {
                channel?: string;
            };
            header?: never;
            path: {
                token: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    content?: string;
                    username?: string;
                    /** Format: uri */
                    avatar_url?: string;
                    embeds?: Record<string, never>[];
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channel: string;
                        messageId: string;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_channels_by_channel_outgoing_webhooks: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        webhooks: components["schemas"]["OutgoingWebhook"][];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_channels_by_channel_outgoing_webhooks: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uri */
                    target_url: string;
                    secret?: string;
                    events?: string[];
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        webhook: components["schemas"]["OutgoingWebhook"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_api_v1_channels_by_channel_outgoing_webhooks_by_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Ok"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_media: {
        parameters: {
            query?: {
                channel?: string;
                dm?: string;
                pending?: "1";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        items: ({
                            id: string;
                            filename: string;
                            mimeType: string;
                            size: number;
                            /** @description Unix epoch milliseconds */
                            createdAt: number;
                        } | {
                            id: string;
                            filename: string;
                            size: number;
                            /** @description Unix epoch milliseconds */
                            createdAt: number;
                            /** @description Unix epoch milliseconds */
                            leaseUntil: number;
                        })[];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_admin_config: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__config"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        config: Record<string, never>;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_admin_config: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__config"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        config: Record<string, never>;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_admin_stats: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_admin_stats: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_admin_broadcast: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__broadcast"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        sentCount: number;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_admin_broadcast: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__broadcast"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        sentCount: number;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_admin_sessions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        sessions: Record<string, never>[];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_admin_sessions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        sessions: Record<string, never>[];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_admin_sessions_disconnect: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__sessions_disconnect"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_admin_sessions_disconnect: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__sessions_disconnect"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_admin_accounts: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        accounts: Record<string, never>[];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_admin_accounts: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__accounts"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        account: components["schemas"]["Account"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_admin_accounts: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        accounts: Record<string, never>[];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_admin_accounts: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__accounts"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        account: components["schemas"]["Account"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_admin_accounts_disable: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__accounts_disable"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_admin_accounts_disable: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__accounts_disable"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_admin_accounts_by_username: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_api_v1_admin_accounts_by_username: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patch_api_v1_admin_accounts_by_username: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_patch__accounts__username_"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        account: components["schemas"]["Account"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_admin_accounts_by_username: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_admin_accounts_by_username: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patch_admin_accounts_by_username: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_patch__accounts__username_"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        account: components["schemas"]["Account"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_admin_accounts_by_username_password: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__accounts__username__password"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_admin_accounts_by_username_password: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__accounts__username__password"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_admin_accounts_by_username_disable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_admin_accounts_by_username_disable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_admin_accounts_by_username_enable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_admin_accounts_by_username_enable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_admin_accounts_by_username_roles: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        username: string;
                        roles: string[];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_admin_accounts_by_username_roles: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__accounts__username__roles"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_admin_accounts_by_username_roles: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        username: string;
                        roles: string[];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_admin_accounts_by_username_roles: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__accounts__username__roles"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_admin_profile_by_username: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        profile: components["schemas"]["Profile"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patch_api_v1_admin_profile_by_username: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_patch__profile__username_"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        profile: components["schemas"]["Profile"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_admin_profile_by_username: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        profile: components["schemas"]["Profile"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patch_admin_profile_by_username: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_patch__profile__username_"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        profile: components["schemas"]["Profile"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_admin_messages_redact: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__messages_redact"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok: boolean;
                        msgId: string;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_admin_messages_redact: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__messages_redact"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok: boolean;
                        msgId: string;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_admin_channels: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channels: Record<string, never>[];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_admin_channels: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channels: Record<string, never>[];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_admin_channels_by_channel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channel: Record<string, never>;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_api_v1_admin_channels_by_channel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_delete__channels__channel_"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok: boolean;
                        channelName: string;
                        recipientSessionIds: string[];
                        purgedCount: number;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_admin_channels_by_channel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channel: Record<string, never>;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_admin_channels_by_channel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_delete__channels__channel_"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok: boolean;
                        channelName: string;
                        recipientSessionIds: string[];
                        purgedCount: number;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_admin_channels_by_channel_info: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channel: components["schemas"]["Channel"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patch_api_v1_admin_channels_by_channel_info: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_patch__channels__channel__info"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channel: components["schemas"]["Channel"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_admin_channels_by_channel_info: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channel: components["schemas"]["Channel"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patch_admin_channels_by_channel_info: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_patch__channels__channel__info"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channel: components["schemas"]["Channel"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_admin_channels_by_channel_register: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__channels__channel__register"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_admin_channels_by_channel_register: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__channels__channel__register"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_admin_channels_by_channel_unregister: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_admin_channels_by_channel_unregister: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_admin_channels_by_channel_modes: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__channels__channel__modes"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_admin_channels_by_channel_modes: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__channels__channel__modes"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_admin_channels_by_channel_topic: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__channels__channel__topic"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_admin_channels_by_channel_topic: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__channels__channel__topic"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_admin_channels_by_channel_kick: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__channels__channel__kick"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_admin_channels_by_channel_kick: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__channels__channel__kick"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_admin_channels_by_channel_bot: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channel: string;
                        bot: Record<string, never>;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_admin_channels_by_channel_bot: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__channels__channel__bot"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channel: string;
                        bot: Record<string, never>;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_admin_channels_by_channel_bot: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channel: string;
                        bot: Record<string, never>;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_admin_channels_by_channel_bot: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__channels__channel__bot"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channel: string;
                        bot: Record<string, never>;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_admin_channels_by_channel_messages: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channel: string;
                        messages: components["schemas"]["Message"][];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_admin_channels_by_channel_messages: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channel: string;
                        messages: components["schemas"]["Message"][];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_admin_channels_by_channel_messages_purge: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__channels__channel__messages_purge"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channel: string;
                        purgedCount: number;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_admin_channels_by_channel_messages_purge: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__channels__channel__messages_purge"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channel: string;
                        purgedCount: number;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_admin_metadata_users_by_target: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                target: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        metadata: Record<string, never>;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    put_api_v1_admin_metadata_users_by_target: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                target: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_put__metadata_users__target_"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_admin_metadata_users_by_target: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                target: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        metadata: Record<string, never>;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    put_admin_metadata_users_by_target: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                target: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_put__metadata_users__target_"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_api_v1_admin_metadata_users_by_target_by_key: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                target: string;
                key: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_admin_metadata_users_by_target_by_key: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                target: string;
                key: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_admin_metadata_channels_by_target: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                target: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        metadata: Record<string, never>;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    put_api_v1_admin_metadata_channels_by_target: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                target: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_put__metadata_channels__target_"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_admin_metadata_channels_by_target: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                target: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        metadata: Record<string, never>;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    put_admin_metadata_channels_by_target: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                target: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_put__metadata_channels__target_"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_api_v1_admin_metadata_channels_by_target_by_key: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                target: string;
                key: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_admin_metadata_channels_by_target_by_key: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                target: string;
                key: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_admin_accounts_by_username_scopes: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        restricted: boolean;
                        scopes: components["schemas"]["CredentialScope"][];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    put_api_v1_admin_accounts_by_username_scopes: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_put__accounts__username__scopes"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Ok"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_admin_accounts_by_username_scopes: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        restricted: boolean;
                        scopes: components["schemas"]["CredentialScope"][];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    put_admin_accounts_by_username_scopes: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_put__accounts__username__scopes"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Ok"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_admin_accounts_by_username_sessions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        sessions: components["schemas"]["AccountSession"][];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_admin_accounts_by_username_sessions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        sessions: components["schemas"]["AccountSession"][];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_api_v1_admin_accounts_by_username_sessions_by_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Ok"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_admin_accounts_by_username_sessions_by_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Ok"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_admin_bans: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        bans: {
                            id: string;
                            /** @enum {string} */
                            kind: "account" | "hostmask";
                            value: string;
                            created_by: string;
                            /** @description Unix epoch milliseconds */
                            created_at: number;
                            /** @description Unix epoch milliseconds */
                            expires_at: number | null;
                        }[];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_admin_bans: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__bans"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        ban: {
                            id: string;
                            /** @enum {string} */
                            kind: "account" | "hostmask";
                            value: string;
                            /** @description Unix epoch milliseconds */
                            expiresAt: number | null;
                        };
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_admin_bans: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        bans: {
                            id: string;
                            /** @enum {string} */
                            kind: "account" | "hostmask";
                            value: string;
                            created_by: string;
                            /** @description Unix epoch milliseconds */
                            created_at: number;
                            /** @description Unix epoch milliseconds */
                            expires_at: number | null;
                        }[];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_admin_bans: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__bans"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        ban: {
                            id: string;
                            /** @enum {string} */
                            kind: "account" | "hostmask";
                            value: string;
                            /** @description Unix epoch milliseconds */
                            expiresAt: number | null;
                        };
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_api_v1_admin_bans_by_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Ok"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_admin_bans_by_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Ok"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_admin_audit: {
        parameters: {
            query?: {
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        records: {
                            id: string;
                            actor_id: string | null;
                            action: string;
                            target: string;
                            /** @enum {string} */
                            outcome: "allowed" | "denied" | "error";
                            transport: string;
                            /** @description Unix epoch milliseconds */
                            created_at: number;
                        }[];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_admin_audit: {
        parameters: {
            query?: {
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        records: {
                            id: string;
                            actor_id: string | null;
                            action: string;
                            target: string;
                            /** @enum {string} */
                            outcome: "allowed" | "denied" | "error";
                            transport: string;
                            /** @description Unix epoch milliseconds */
                            created_at: number;
                        }[];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_admin_accounts_register: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__accounts"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        account: components["schemas"]["Account"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_admin_accounts_register: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Admin_post__accounts"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        account: components["schemas"]["Account"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_events: {
        parameters: {
            query?: {
                /** @description Single-use ticket from POST /api/v1/auth/events-ticket */
                ticket?: string;
            };
            header?: {
                /** @description Negotiate version 2 for sustained streaming with reader.challenge/reader.ack flow control */
                "Sec-WebSocket-Protocol"?: "flarc.events.v2";
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description WebSocket upgraded; server frames contain RealtimeEvent payloads or command result/error control envelopes */
            101: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Invalid session/ticket */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Origin denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description WebSocket upgrade required */
            426: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Connection/subscription budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_accounts_register: {
        parameters: {
            query?: never;
            header?: {
                /** @description Shared invite code when signup policy is invite */
                "X-Signup-Token"?: string;
                /** @description One-time bootstrap of a reserved ADMIN_USERS account before any administrator has been provisioned */
                "X-Bootstrap-Token"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RegisterRequest"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        account: components["schemas"]["Account"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_profile_by_username: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        profile: components["schemas"]["Profile"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patch_api_profile_by_username: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateProfile"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        profile: components["schemas"]["Profile"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_channels_by_channel_info: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channel: components["schemas"]["Channel"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patch_api_channels_by_channel_info: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateChannel"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channel: components["schemas"]["Channel"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_channels_by_channel_unread: {
        parameters: {
            query?: {
                /** @description Defaults to caller; must identify the caller */
                username?: string;
                /** @description Legacy username alias */
                user?: string;
            };
            header?: never;
            path: {
                channel: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Unread"] & {
                        /** @constant */
                        ok: true;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_users_by_username_unread: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        username: string;
                        channels: components["schemas"]["Unread"][];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_media_upload: {
        parameters: {
            query?: {
                /** @description Explicit channel scope; caller must be an authorized member */
                channel?: string;
                /** @description Explicit recipient account; both accounts can read */
                dm?: string;
            };
            header?: {
                "X-Filename"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": {
                    /** Format: binary */
                    file: string;
                };
                "application/octet-stream": string;
                "image/png": string;
                "text/plain": string;
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Upload"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_webpush_subscribe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Subscribe"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        registered: boolean;
                        endpoint: string;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_api_webpush_subscribe: {
        parameters: {
            query?: {
                username?: string;
                endpoint?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        removed: boolean;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_webpush_subscriptions: {
        parameters: {
            query?: {
                username?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        username: string;
                        endpoints: string[];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_v1_messages_search: {
        parameters: {
            query?: {
                /** @description Search text with inline in:/from:/has:/tag: filters */
                q?: string;
                limit?: number;
                from?: string | string[];
                mentions?: string | string[];
                has?: string | string[];
                tag?: string | string[];
                sender?: string;
                before?: string;
                after?: string;
                on?: string;
                author?: string;
                pinned?: string;
                cursor?: string;
                in?: string | string[];
                conversationId?: string | string[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SearchResult"];
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_health: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok: boolean;
                        service: string;
                        network: string;
                        server: string;
                        version: string;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_status: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok: boolean;
                        status: string;
                        service: string;
                        network: string;
                        server: string;
                        version: string;
                        time: string;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_v1_webhooks_by_id_by_token: {
        parameters: {
            query?: {
                channel?: string;
            };
            header?: never;
            path: {
                /** @description Webhook identifier */
                id: string;
                token: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    content?: string;
                    username?: string;
                    /** Format: uri */
                    avatar_url?: string;
                    embeds?: Record<string, never>[];
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channel: string;
                        messageId: string;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_webhooks_by_id_by_token: {
        parameters: {
            query?: {
                channel?: string;
            };
            header?: never;
            path: {
                /** @description Webhook identifier */
                id: string;
                token: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    content?: string;
                    username?: string;
                    /** Format: uri */
                    avatar_url?: string;
                    embeds?: Record<string, never>[];
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        channel: string;
                        messageId: string;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_conversations: {
        parameters: {
            query?: {
                limit?: number;
                after?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        conversations: components["schemas"]["Conversation"][];
                        nextConversationId: string | null;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_conversations: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateConversation"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        conversation: components["schemas"]["Conversation"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_conversations_by_conversation: {
        parameters: {
            query?: {
                senderId?: string;
                recipientId?: string;
            };
            header?: never;
            path: {
                conversation: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        conversation: components["schemas"]["Conversation"];
                        unread: number;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_conversations_by_conversation_messages: {
        parameters: {
            query?: {
                senderId?: string;
                recipientId?: string;
                limit?: number;
                before?: string;
                after?: string;
            };
            header?: never;
            path: {
                conversation: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        messages: components["schemas"]["ConversationMessage"][];
                        hasMore: boolean;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_conversations_by_conversation_messages: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                conversation: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SendConversationMessage"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        message: components["schemas"]["ConversationMessage"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_conversations_by_conversation_messages_by_message: {
        parameters: {
            query?: {
                senderId?: string;
                recipientId?: string;
            };
            header?: never;
            path: {
                conversation: string;
                message: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        message: components["schemas"]["ConversationMessage"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_api_conversations_by_conversation_messages_by_message: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                conversation: string;
                message: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RedactConversationMessage"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        message: components["schemas"]["ConversationMessage"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patch_api_conversations_by_conversation_messages_by_message: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                conversation: string;
                message: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EditConversationMessage"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        message: components["schemas"]["ConversationMessage"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    post_api_conversations_by_conversation_read: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                conversation: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReadConversation"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        conversationId: string;
                        messageId: string;
                        unread: number;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_conversations_by_conversation_unread: {
        parameters: {
            query?: {
                senderId?: string;
                recipientId?: string;
            };
            header?: never;
            path: {
                conversation: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        conversationId: string;
                        unread: number;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_conversations_by_conversation_attachments: {
        parameters: {
            query?: {
                senderId?: string;
                recipientId?: string;
            };
            header?: never;
            path: {
                conversation: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        attachments: {
                            id: string;
                            filename: string;
                            mimeType: string;
                            size: number;
                            /** @description Unix epoch milliseconds */
                            createdAt: number;
                        }[];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_dms_messages_by_message: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                message: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        message: components["schemas"]["ConversationMessage"];
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_metadata_by_target: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                target: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        metadata: {
                            [key: string]: string | null;
                        };
                        revision: number;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patch_api_metadata_by_target: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                target: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateMetadata"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        result: {
                            key: string;
                            value: string | null;
                            username: string;
                        };
                        revision: number;
                        replayed: boolean;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_events_replay: {
        parameters: {
            query: {
                cursor: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        events: (components["schemas"]["RealtimeEvent"] & {
                            cursor: string;
                        })[];
                        cursor: string;
                        caughtUp: boolean;
                        /** @constant */
                        readOnly: true;
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description CURSOR_EXPIRED: obtain a new bootstrap snapshot and reconcile state */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_api_events_bootstrap: {
        parameters: {
            query?: {
                /** @description Opaque account-bound continuation token from nextPageToken; never a channel name */
                pageToken?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        cursor: string;
                        conversations: components["schemas"]["Conversation"][];
                        nextConversationId: string | null;
                        channelsComplete: boolean;
                        nextPageToken: string | null;
                        channels: {
                            channel: string;
                            /** Format: uuid */
                            generation: string;
                            canRead: boolean;
                            canWrite: boolean;
                            isMember: boolean;
                            memberModes: string;
                            revision: number;
                            info: components["schemas"]["Channel"];
                            history: components["schemas"]["Message"][] | null;
                            readMarker: string | null;
                            eventBoundary: {
                                /** @constant */
                                kind: "membership";
                                generation: string;
                                revision: number;
                            };
                        }[];
                        profile: components["schemas"]["Profile"] | null;
                        recovery: {
                            /** @constant */
                            mode: "cursor-before-snapshot";
                            interestBoundary: string;
                            replayFrom: string;
                            deduplicateBy: string[];
                            /** @constant */
                            crossObjectAtomic: false;
                        };
                    };
                };
            };
            /** @description Invalid input or policy denied */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, expired or revoked account session */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found or private media not authorized */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource generation, revision or operation identity conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Bootstrap page or original recovery cursor expired; restart bootstrap/resync */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body exceeds the configured limit: JSON defaults to 64 KiB; media defaults to 10 MiB and uses FILEHOST_MAX_UPLOAD_BYTES */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request budget exceeded */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    get_metrics: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Prometheus text */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            /** @description Session required */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
}
