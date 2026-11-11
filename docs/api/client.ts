export interface paths {
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Server Health */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Server status */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            ok?: boolean;
                            service?: string;
                            network?: string;
                            server?: string;
                            version?: string;
                        };
                    };
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
        /** Register Account */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["RegisterRequest"];
                };
            };
            responses: {
                /** @description Registered successfully */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Invalid input or account already exists */
                400: {
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
        /** Verify Credentials */
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
                /** @description Authentication successful */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Invalid credentials */
                401: {
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
    "/api/v1/profiles/{username}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get User Profile */
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
                /** @description Profile returned */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UserProfile"];
                    };
                };
                /** @description User not found */
                404: {
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
        /** Update User Profile */
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
                    "application/json": components["schemas"]["UserProfileInput"];
                };
            };
            responses: {
                /** @description Profile updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description User not found */
                404: {
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
        /** List Channels */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description List of active channels */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            ok?: boolean;
                            channels?: components["schemas"]["ChannelSummary"][];
                        };
                    };
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
        /** Get Channel Info */
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
                /** @description Channel details */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ChannelInfo"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update Channel Info */
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
                    "application/json": components["schemas"]["ChannelInfoUpdate"];
                };
            };
            responses: {
                /** @description Channel info updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        trace?: never;
    };
    "/api/v1/channels/{channel}/unread": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Channel Unread Summary */
        get: {
            parameters: {
                query?: {
                    username?: string;
                };
                header?: never;
                path: {
                    channel: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Unread count and mention summary */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnreadSummary"];
                    };
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
        /** List Channel Role Groups */
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
                /** @description List of role groups */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            ok?: boolean;
                            roles?: components["schemas"]["RoleGroup"][];
                        };
                    };
                };
            };
        };
        put?: never;
        /** Create Channel Role Group */
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
                    "application/json": components["schemas"]["CreateRoleGroupRequest"];
                };
            };
            responses: {
                /** @description Role group created */
                201: {
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
        /** Delete Channel Role Group */
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
                /** @description Role group deleted */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        /** Update Channel Role Group */
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
                    "application/json": components["schemas"]["CreateRoleGroupRequest"];
                };
            };
            responses: {
                /** @description Role group updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Role group not found */
                404: {
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
        /** Assign Role to User */
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
                        userId: string;
                        roleGroupId: string;
                    };
                };
            };
            responses: {
                /** @description Role assigned */
                200: {
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
    "/api/v1/channels/{channel}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Channel Messages */
        get: {
            parameters: {
                query?: {
                    limit?: number;
                    before?: string;
                    after?: string;
                };
                header?: never;
                path: {
                    channel: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description List of messages */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            ok?: boolean;
                            messages?: components["schemas"]["StoredMessage"][];
                        };
                    };
                };
            };
        };
        put?: never;
        /** Send Message */
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
                    "application/json": components["schemas"]["SendMessageRequest"];
                };
            };
            responses: {
                /** @description Message sent */
                201: {
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
        /** Redact Message */
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
                /** @description Message redacted */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        /** Edit Message */
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
                    "application/json": {
                        content: string;
                        senderNick?: string;
                    };
                };
            };
            responses: {
                /** @description Message edited */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Message not found */
                404: {
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
        /** Search Channel Messages (FTS5 & Filter Tags) */
        get: {
            parameters: {
                query?: {
                    q?: string;
                    from?: string;
                    mentions?: string;
                    has?: "link" | "image" | "gif" | "video" | "file";
                    before?: string;
                    after?: string;
                    on?: string;
                    author?: "user" | "bot";
                    tag?: string;
                    limit?: number;
                };
                header?: never;
                path: {
                    channel: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Matching messages returned */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            ok?: boolean;
                            channel?: string;
                            query?: string;
                            filters?: Record<string, never>;
                            count?: number;
                            messages?: components["schemas"]["StoredMessage"][];
                        };
                    };
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
        /** Global Cross-Channel Message Search */
        get: {
            parameters: {
                query?: {
                    q?: string;
                    in?: string;
                    from?: string;
                    mentions?: string;
                    has?: "link" | "image" | "gif" | "video" | "file";
                    before?: string;
                    after?: string;
                    on?: string;
                    author?: "user" | "bot";
                    tag?: string;
                    limit?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Matching messages returned across channels */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            ok?: boolean;
                            channels?: string[];
                            query?: string;
                            filters?: Record<string, never>;
                            count?: number;
                            messages?: components["schemas"]["StoredMessage"][];
                        };
                    };
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
        /** List Channel Webhooks */
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
                /** @description Webhooks list */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        /** Create Incoming Webhook */
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
                        avatar_url?: string;
                        created_by?: string;
                    };
                };
            };
            responses: {
                /** @description Webhook created */
                201: {
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
        /** Delete Webhook */
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
                /** @description Webhook deleted */
                200: {
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
        /** Execute Incoming Webhook (Discord/Slack Compatible) */
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
                        content: string;
                        username?: string;
                        avatar_url?: string;
                    };
                };
            };
            responses: {
                /** @description Webhook executed and message dispatched */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Invalid token or payload */
                400: {
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
    "/api/v1/users/{username}/unread": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get User Multi-Channel Unread Summary */
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
                /** @description Unread summaries for all channels */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            ok?: boolean;
                            username?: string;
                            channels?: components["schemas"]["UnreadSummary"][];
                        };
                    };
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
         * Upload Media File
         * @description Upload media using multipart/form-data or raw octet-stream with X-Filename header.
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
                    "multipart/form-data": {
                        /** Format: binary */
                        file?: string;
                    };
                    "application/octet-stream": string;
                };
            };
            responses: {
                /** @description Uploaded successfully */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MediaUploadResponse"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description File hosting disabled */
                403: {
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
        /** Get Media File */
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
                /** @description File content */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/octet-stream": string;
                    };
                };
                /** @description File not found */
                404: {
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
    "/api/v1/notifications/subscribe": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Subscribe to WebPush */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        username: string;
                        endpoint: string;
                        keys?: {
                            p256dh?: string;
                            auth?: string;
                        };
                    };
                };
            };
            responses: {
                /** @description Subscribed successfully */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        /** Unsubscribe from WebPush */
        delete: {
            parameters: {
                query: {
                    username: string;
                    endpoint: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Unsubscribed successfully */
                200: {
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
        /** List Subscriptions for User */
        get: {
            parameters: {
                query: {
                    username: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description List of endpoints */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            ok?: boolean;
                            username?: string;
                            endpoints?: string[];
                        };
                    };
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
    "/api/v1/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Real-time Event Stream (WebSocket)
         * @description WebSocket connection streaming typed application domain events.
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
                /** @description WebSocket connection established */
                101: {
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
        RegisterRequest: {
            username: string;
            password: string;
            displayName?: string;
            roles?: string[];
        };
        LoginRequest: {
            username: string;
            password: string;
        };
        UserProfile: {
            username?: string;
            displayName?: string | null;
            avatar?: string | null;
            bio?: string | null;
            pronouns?: string | null;
            color?: string | null;
            url?: string | null;
            bot?: boolean;
        };
        UserProfileInput: {
            displayName?: string | null;
            avatar?: string | null;
            bio?: string | null;
            pronouns?: string | null;
            color?: string | null;
            url?: string | null;
            bot?: boolean;
        };
        ChannelSummary: {
            channelName?: string;
            canonicalChannel?: string;
            userCount?: number;
        };
        ChannelInfo: {
            channel?: string;
            canonicalName?: string;
            topic?: string | null;
            topicSetBy?: string | null;
            topicSetAt?: number | null;
            modes?: string;
            registered?: boolean;
            founder?: string | null;
            registeredAt?: number | null;
            avatar?: string | null;
            description?: string | null;
            category?: string | null;
            color?: string | null;
            readOnly?: boolean;
            memberCount?: number;
            createdAt?: number;
            tags?: string[];
            nsfw?: boolean;
        };
        ChannelInfoUpdate: {
            avatar?: string | null;
            description?: string | null;
            category?: string | null;
            color?: string | null;
            readOnly?: boolean | null;
            topic?: string | null;
            tags?: string[];
            nsfw?: boolean;
        };
        UnreadSummary: {
            channel?: string;
            username?: string | null;
            unreadCount?: number;
            mentionCount?: number;
            lastMessageId?: string | null;
            lastMessageTime?: number | null;
            lastReadTimestamp?: string | null;
        };
        RoleGroup: {
            id?: string;
            name?: string;
            color?: string | null;
            position?: number;
            ircMode?: string | null;
            permissions?: Record<string, never>;
            createdAt?: number;
            updatedAt?: number;
        };
        CreateRoleGroupRequest: {
            name: string;
            color?: string;
            position?: number;
            ircMode?: string;
            permissions?: Record<string, never>;
        };
        SendMessageRequest: {
            content: string;
            senderNick?: string;
            tags?: Record<string, never>;
        };
        StoredMessage: {
            id?: string;
            sequence?: number;
            senderNick?: string;
            content?: string;
            tags?: Record<string, never>;
            timestamp?: number;
        };
        MediaUploadResponse: {
            ok?: boolean;
            id?: string;
            url?: string;
            filename?: string;
            size?: number;
            mimeType?: string;
            uploader?: string;
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
