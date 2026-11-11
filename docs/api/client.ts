export interface paths {
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Public health */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Returns a random 256-bit bearer token, expiring after 24 hours. Up to 20 sessions per account. Tokens are stored as hashes; password reset, disable/delete, and logout revoke access. Invalid credentials return 401.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
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
                /** @description Resource not found or private media not authorized */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Error"];
                    };
                };
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Upgrade: websocket required (426 otherwise). Non-browser clients may send Authorization: Bearer. Browser clients use a short-lived ticket. Each event rechecks session validity and channel permissions, including bans and archived channels. Events are transient; reconnect through persisted history rather than an event-replay cursor. Per-account subscription limit: 5. Cross-origin browsers require ALLOWED_ORIGINS.
         */
        get: {
            parameters: {
                query?: {
                    /** @description Single-use ticket from POST /api/v1/auth/events-ticket */
                    ticket?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description WebSocket upgraded; frames conform to RealtimeEvent */
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
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Update your own profile
         * @description The authenticated account must own this profile; the client API does not grant an administrator override.
         */
        patch: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        put?: never;
        post?: never;
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
         * @description Pass the IRC channel name URL-encoded, e.g. %23general. Public history requires authentication. Secret/private/invite-only/keyed channels require authorized membership or a persistent founder grant; bans deny ordinary reads. Members can read retained history predating their join. Archived channel names remain reserved to protect retained data.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Update channel metadata as an operator/founder
         * @description Current channel management permission is checked by ChannelDO; selected custom role grants are authoritative.
         */
        patch: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Pass the IRC channel name URL-encoded, e.g. %23general. Public history requires authentication. Secret/private/invite-only/keyed channels require authorized membership or a persistent founder grant; bans deny ordinary reads. Members can read retained history predating their join. Archived channel names remain reserved to protect retained data. Redacted and expired rows are excluded. before/after use stable message sequence ordering; pagination.has_more uses one extra row.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        put?: never;
        /**
         * Send a message as the authenticated channel member
         * @description Join the channel first. Sender identity comes from the verified account and membership; senderNick is a deprecated ignored input. Only valid client-prefixed tags are accepted. Channel moderation, bans and read-only policy also apply to REST. A 201 means committed storage; live events and outgoing delivery do not provide a durable delivery guarantee.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        delete: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        options?: never;
        head?: never;
        /**
         * Edit your own unredacted, unexpired message
         * @description Ownership uses the immutable author account ID. A current channel membership is required. A client-provided senderNick cannot establish ownership.
         */
        patch: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Pass the IRC channel name URL-encoded, e.g. %23general. Public history requires authentication. Secret/private/invite-only/keyed channels require authorized membership or a persistent founder grant; bans deny ordinary reads. Members can read retained history predating their join. Archived channel names remain reserved to protect retained data.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Pass the IRC channel name URL-encoded, e.g. %23general. Public history requires authentication. Secret/private/invite-only/keyed channels require authorized membership or a persistent founder grant; bans deny ordinary reads. Members can read retained history predating their join. Archived channel names remain reserved to protect retained data.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        put?: never;
        /** Create a channel role as founder/administrator */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        delete: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        options?: never;
        head?: never;
        /** Update a channel role as founder/administrator */
        patch: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Pass the IRC channel name URL-encoded, e.g. %23general. Public history requires authentication. Secret/private/invite-only/keyed channels require authorized membership or a persistent founder grant; bans deny ordinary reads. Members can read retained history predating their join. Archived channel names remain reserved to protect retained data.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        put: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        /** Remove your push subscription */
        delete: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description No scope means uploader-only. Requires a logged-in API session; nickname/Basic headers do not authenticate. Maximum 10 MiB request and 100 MiB stored per account. R2 is private and accessed only after persisted scope checks. Unowned legacy files are quarantined.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        delete: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        put?: never;
        /**
         * Create a channel-scoped incoming webhook capability
         * @description Channel operator/founder/admin only. The creator comes from the authenticated account.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        delete: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        put?: never;
        /**
         * Configure an operator-allowed HTTPS outgoing hook
         * @description Channel management permission and an explicit OUTGOING_WEBHOOK_ALLOWED_HOSTS match are required. Redirects are rejected. Delivery is best effort after storage commits; no durable retry/outbox guarantee is made.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        delete: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        put?: never;
        /**
         * Provision an account with explicit roles
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        put?: never;
        /**
         * Provision an account with explicit roles
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        put?: never;
        post?: never;
        /**
         * Delete account-owned state; preserve channel history
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        delete: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        options?: never;
        head?: never;
        /**
         * Update explicit account fields
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        patch: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        put?: never;
        post?: never;
        /**
         * Delete account-owned state; preserve channel history
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        delete: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        options?: never;
        head?: never;
        /**
         * Update explicit account fields
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        patch: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        put?: never;
        /**
         * Grant/revoke a global role
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        put?: never;
        /**
         * Grant/revoke a global role
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Administratively update a profile
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        patch: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Administratively update a profile
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        patch: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        put?: never;
        post?: never;
        /**
         * Archive a channel, optionally purge its messages
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        delete: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        put?: never;
        post?: never;
        /**
         * Archive a channel, optionally purge its messages
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        delete: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Administratively update channel metadata
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        patch: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Administratively update channel metadata
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        patch: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        put?: never;
        /**
         * Configure the channel F bot
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        put?: never;
        /**
         * Configure the channel F bot
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        /**
         * Set validated metadata entries
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        put: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        /**
         * Set validated metadata entries
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        put: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        delete: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        delete: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        /**
         * Set validated metadata entries
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        put: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        /**
         * Set validated metadata entries
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        put: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        delete: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        delete: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Update your own profile
         * @description Legacy/compatibility alias of /api/v1/profiles/{username}. The authenticated account must own this profile; the client API does not grant an administrator override.
         */
        patch: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Legacy/compatibility alias of /api/v1/channels/{channel}/info. Pass the IRC channel name URL-encoded, e.g. %23general. Public history requires authentication. Secret/private/invite-only/keyed channels require authorized membership or a persistent founder grant; bans deny ordinary reads. Members can read retained history predating their join. Archived channel names remain reserved to protect retained data.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Update channel metadata as an operator/founder
         * @description Legacy/compatibility alias of /api/v1/channels/{channel}/info. Current channel management permission is checked by ChannelDO; selected custom role grants are authoritative.
         */
        patch: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Legacy/compatibility alias of /api/v1/channels/{channel}/unread. Pass the IRC channel name URL-encoded, e.g. %23general. Public history requires authentication. Secret/private/invite-only/keyed channels require authorized membership or a persistent founder grant; bans deny ordinary reads. Members can read retained history predating their join. Archived channel names remain reserved to protect retained data.
         */
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
         * @description Legacy/compatibility alias of /api/v1/media/upload. No scope means uploader-only. Requires a logged-in API session; nickname/Basic headers do not authenticate. Maximum 10 MiB request and 100 MiB stored per account. R2 is private and accessed only after persisted scope checks. Unowned legacy files are quarantined.
         */
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        /**
         * Remove your push subscription
         * @description Legacy/compatibility alias of /api/v1/notifications/subscribe.
         */
        delete: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        get: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        post: {
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
                /** @description Body exceeds 64 KiB JSON / 10 MiB media limit */
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
        get: {
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
            data?: unknown;
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
        };
        Channel: {
            channel: string;
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
            /** @enum {string} */
            type: "message.created" | "message.updated" | "message.deleted" | "channel.created" | "channel.updated" | "channel.deleted" | "channel.member_joined" | "channel.member_left" | "channel.topic_changed" | "channel.metadata_updated" | "channel.role_created" | "channel.role_updated" | "channel.role_deleted" | "channel.member_role_changed" | "auth.registered" | "auth.logged_in" | "user.profile_updated" | "unread.updated";
            eventId: string;
            channelId?: string;
            messageId?: string;
            senderId?: string;
            sequence?: number;
            timestamp: string;
            data: {
                [key: string]: unknown;
            };
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
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
