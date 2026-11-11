import { defineEventHandler } from "nitro/h3";
import { z } from "zod";
import { SERVER_CONFIG } from "~/core/config";
import * as admin from "~/schemas/admin";
import { LoginRequestSchema, RegisterRequestSchema } from "~/schemas/auth";
import {
  AssignUserRoleSchema,
  ChannelInfoSchema,
  CreateRoleGroupSchema,
  UpdateChannelInfoSchema,
} from "~/schemas/channels";
import { RealtimeEventSchema } from "~/schemas/events";
import { EditMessageSchema, SendMessageSchema } from "~/schemas/messages";
import { WebPushSubscribeSchema } from "~/schemas/notifications";
import { UserProfileInputSchema, UserProfileSchema } from "~/schemas/profiles";
import { getEnv } from "~/utils/auth";

/** Schemas are shared with runtime validators. Transport-specific responses are defined explicitly. */
export function generateOpenAPISpec() {
  const string = { type: "string" };
  const number = { type: "number" };
  const integer = { type: "integer" };
  const boolean = { type: "boolean" };
  const nullableString = { type: ["string", "null"] };
  const nullableNumber = { type: ["number", "null"] };
  const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
  const array = (items: any) => ({ type: "array", items });
  const object = (properties: Record<string, any>, required = Object.keys(properties)) => ({
    type: "object",
    properties,
    required,
  });
  const ok = (properties: Record<string, any> = {}) =>
    object({ ok: { type: "boolean", const: true }, ...properties });
  const json = (schema: any) => ({ "application/json": { schema } });
  const parameter = (
    name: string,
    location = "query",
    schema: any = string,
    description?: string,
  ) => ({
    name,
    in: location,
    required: location === "path",
    schema,
    ...(description ? { description } : {}),
  });
  const paths: Record<string, any> = {};
  const schemas: Record<string, any> = {};
  const runtimeSchema = (name: string, schema: z.ZodType, input = true) => {
    schemas[name] = z.toJSONSchema(schema, { io: input ? "input" : "output" });
    return ref(name);
  };
  const operation = (
    path: string,
    method: string,
    summary: string,
    response: any,
    options: {
      body?: any;
      status?: number;
      parameters?: any[];
      description?: string;
      public?: boolean;
      tag?: string;
      security?: any[];
    } = {},
  ) => {
    const parameters = [
      ...Array.from(path.matchAll(/\{([^}]+)\}/g), (m) => parameter(m[1], "path")),
      ...(options.parameters ?? []),
    ];
    paths[path] ??= {};
    paths[path][method] = {
      summary,
      tags: [options.tag ?? "Client"],
      ...(options.description ? { description: options.description } : {}),
      ...(parameters.length ? { parameters } : {}),
      ...(options.body ? { requestBody: { required: true, content: json(options.body) } } : {}),
      ...(options.public
        ? { security: [] }
        : options.security
          ? { security: options.security }
          : {}),
      responses: {
        [String(options.status ?? 200)]: { description: "Success", content: json(response) },
        "400": { description: "Invalid input or policy denied", content: json(ref("Error")) },
        ...(!options.public
          ? {
              "401": {
                description: "Missing, expired or revoked account session",
                content: json(ref("Error")),
              },
              "403": { description: "Resource permission denied", content: json(ref("Error")) },
            }
          : {}),
        "404": {
          description: "Resource not found or private media not authorized",
          content: json(ref("Error")),
        },
        "413": { description: "Body exceeds 64 KiB JSON / 10 MiB media limit" },
        "429": { description: "Request budget exceeded" },
      },
    };
  };
  schemas.Error = object(
    { statusCode: integer, statusMessage: string, message: string, data: {} },
    [],
  );
  schemas.Ok = ok();
  schemas.Account = object(
    {
      id: string,
      username: string,
      displayName: nullableString,
      roles: array(string),
      createdAt: number,
      credentialVersion: integer,
    },
    ["id", "username", "displayName", "roles", "createdAt"],
  );
  schemas.Pagination = object({
    count: integer,
    limit: integer,
    has_more: boolean,
    oldest_id: nullableString,
    newest_id: nullableString,
  });
  schemas.Message = object(
    {
      id: string,
      sequence: integer,
      senderId: string,
      senderAccount: nullableString,
      senderNick: string,
      senderUser: string,
      senderHost: string,
      command: string,
      content: string,
      tags: { type: "object", additionalProperties: { type: ["string", "boolean"] } },
      multilineLines: array(object({ content: string, concat: boolean })),
      redacted: boolean,
      createdAt: number,
      expiresAt: number,
    },
    [
      "id",
      "sequence",
      "senderId",
      "senderAccount",
      "senderNick",
      "senderUser",
      "senderHost",
      "command",
      "content",
      "createdAt",
      "expiresAt",
    ],
  );
  schemas.DirectMessage = object(
    {
      id: string,
      sequence: integer,
      senderId: string,
      senderAccount: nullableString,
      senderNick: string,
      targetNick: string,
      command: string,
      content: string,
      tags: { type: "object" },
      multilineLines: array(object({ content: string, concat: boolean })),
      redacted: boolean,
      createdAt: number,
    },
    [
      "id",
      "sequence",
      "senderId",
      "senderAccount",
      "senderNick",
      "targetNick",
      "command",
      "content",
      "redacted",
      "createdAt",
    ],
  );
  schemas.Role = object({
    id: string,
    name: string,
    color: nullableString,
    ircMode: nullableString,
    ircPrefix: nullableString,
    priority: integer,
    permissions: array(string),
    createdAt: number,
    updatedAt: number,
  });
  schemas.Webhook = object({
    id: string,
    name: string,
    token: string,
    avatar_url: nullableString,
    created_by: string,
    created_at: number,
  });
  schemas.OutgoingWebhook = object({
    id: string,
    target_url: string,
    events: array(string),
    created_at: number,
  });
  schemas.Unread = object({
    channel: string,
    username: nullableString,
    unreadCount: integer,
    mentionCount: integer,
    lastMessageId: nullableString,
    lastMessageTime: nullableNumber,
    lastReadTimestamp: nullableString,
  });
  schemas.Unread.required = schemas.Unread.required.filter((key: string) => key !== "username");
  runtimeSchema("Profile", UserProfileSchema, false);
  runtimeSchema("Channel", ChannelInfoSchema, false);
  runtimeSchema("RealtimeEvent", RealtimeEventSchema, false);
  const historyParameters = [
    parameter("limit", "query", { type: "integer", minimum: 1, maximum: 100, default: 50 }),
    parameter("before", "query", string, "Message ID or timestamp, within this conversation"),
    parameter("after", "query", string),
    parameter("around", "query", string),
  ];
  const searchParameters = [
    parameter("q", "query", string, "Search text with inline in:/from:/has:/tag: filters"),
    parameter("limit", "query", { type: "integer", minimum: 1, maximum: 100, default: 50 }),
    ...["from", "mentions", "has", "tag"].map((name) =>
      parameter(name, "query", { oneOf: [string, array(string)] }),
    ),
    ...["sender", "before", "after", "on", "author", "pinned", "cursor"].map((name) =>
      parameter(name),
    ),
  ];

  operation(
    "/health",
    "get",
    "Public health",
    object({ ok: boolean, service: string, network: string, server: string, version: string }),
    { public: true, tag: "System" },
  );
  operation(
    "/status",
    "get",
    "Public status",
    object({
      ok: boolean,
      status: string,
      service: string,
      network: string,
      server: string,
      version: string,
      time: string,
    }),
    { public: true, tag: "System" },
  );
  operation(
    "/api/v1/auth/register",
    "post",
    "Create an account under the server signup policy",
    ok({ account: ref("Account") }),
    {
      public: true,
      tag: "Auth",
      status: 201,
      body: runtimeSchema("RegisterRequest", RegisterRequestSchema),
      parameters: [
        parameter(
          "X-Signup-Token",
          "header",
          string,
          "Shared invite code when signup policy is invite",
        ),
        parameter(
          "X-Bootstrap-Token",
          "header",
          string,
          "One-time bootstrap of a reserved ADMIN_USERS account before any administrator has been provisioned",
        ),
      ],
      description:
        "Signup defaults closed. Public input cannot assign roles. Password length is enforced by server policy (secure default 12 characters, maximum 1024). Bootstrap credentials do not authorize administrative APIs.",
    },
  );
  operation(
    "/api/v1/auth/login",
    "post",
    "Authenticate and create an expiring API session",
    ok({ account: ref("Account"), token: string, expiresAt: number }),
    {
      public: true,
      tag: "Auth",
      body: runtimeSchema("LoginRequest", LoginRequestSchema),
      description:
        "Returns a random 256-bit bearer token, expiring after 24 hours. Up to 20 sessions per account. Tokens are stored as hashes; password reset, disable/delete, and logout revoke access. Invalid credentials return 401.",
    },
  );
  paths["/api/v1/auth/login"].post.responses["401"] = { description: "Invalid credentials" };
  operation("/api/v1/auth/logout", "post", "Revoke the current API session", ref("Ok"), {
    tag: "Auth",
  });
  operation(
    "/api/v1/auth/events-ticket",
    "post",
    "Issue a 30-second, single-use event connection ticket",
    ok({ ticket: string, expiresIn: { type: "integer", const: 30 } }),
    {
      tag: "Auth",
      description:
        "Use the ticket in the events WebSocket handshake. Reusable session credentials must not be put in a URL.",
    },
  );
  operation("/api/v1/events", "get", "Authenticated WebSocket events", ref("RealtimeEvent"), {
    tag: "Events",
    security: [{ SessionToken: [] }, { EventTicket: [] }],
    parameters: [
      parameter(
        "ticket",
        "query",
        string,
        "Single-use ticket from POST /api/v1/auth/events-ticket",
      ),
    ],
    description:
      "Upgrade: websocket required (426 otherwise). Non-browser clients may send Authorization: Bearer. Browser clients use a short-lived ticket. Each event rechecks session validity and channel permissions, including bans and archived channels. Events are transient; reconnect through persisted history rather than an event-replay cursor. Per-account subscription limit: 5. Cross-origin browsers require ALLOWED_ORIGINS.",
  });
  paths["/api/v1/events"].get.responses = {
    "101": { description: "WebSocket upgraded; frames conform to RealtimeEvent" },
    "401": { description: "Invalid session/ticket" },
    "403": { description: "Origin denied" },
    "426": { description: "WebSocket upgrade required" },
    "429": { description: "Connection/subscription budget exceeded" },
  };
  const profilePath = "/api/v1/profiles/{username}";
  operation(profilePath, "get", "Read a registered profile", ok({ profile: ref("Profile") }));
  operation(profilePath, "patch", "Update your own profile", ok({ profile: ref("Profile") }), {
    body: runtimeSchema("UpdateProfile", UserProfileInputSchema),
    description:
      "The authenticated account must own this profile; the client API does not grant an administrator override.",
  });
  operation(
    "/api/v1/channels",
    "get",
    "List channels visible to the authenticated account",
    ok({
      channels: array(
        object({ channelName: string, canonicalName: string, activeMemberCount: integer }),
      ),
    }),
  );
  const channel = "/api/v1/channels/{channel}";
  const channelPolicy =
    "Pass the IRC channel name URL-encoded, e.g. %23general. Public history requires authentication. Secret/private/invite-only/keyed channels require authorized membership or a persistent founder grant; bans deny ordinary reads. Members can read retained history predating their join. Archived channel names remain reserved to protect retained data.";
  operation(
    `${channel}/info`,
    "get",
    "Read authorized channel metadata",
    ok({ channel: ref("Channel") }),
    { description: channelPolicy },
  );
  operation(
    `${channel}/info`,
    "patch",
    "Update channel metadata as an operator/founder",
    ok({ channel: ref("Channel") }),
    {
      body: runtimeSchema("UpdateChannel", UpdateChannelInfoSchema),
      description:
        "Current channel management permission is checked by ChannelDO; selected custom role grants are authoritative.",
    },
  );
  operation(
    `${channel}/messages`,
    "get",
    "Read authorized retained channel messages",
    ok({ channel: string, messages: array(ref("Message")), pagination: ref("Pagination") }),
    {
      parameters: historyParameters,
      description:
        channelPolicy +
        " Redacted and expired rows are excluded. before/after use stable message sequence ordering; pagination.has_more uses one extra row.",
    },
  );
  operation(
    `${channel}/messages`,
    "post",
    "Send a message as the authenticated channel member",
    ok({ message: ref("Message") }),
    {
      status: 201,
      body: runtimeSchema("SendMessage", SendMessageSchema),
      parameters: [
        parameter(
          "Idempotency-Key",
          "header",
          { type: "string", maxLength: 128 },
          "Retries with the same account/channel/key reuse the committed message; a different payload is rejected",
        ),
      ],
      description:
        "Join the channel first. Sender identity comes from the verified account and membership; senderNick is a deprecated ignored input. Only valid client-prefixed tags are accepted. Channel moderation, bans and read-only policy also apply to REST. A 201 means committed storage; live events and outgoing delivery do not provide a durable delivery guarantee.",
    },
  );
  operation(
    `${channel}/messages/{id}`,
    "patch",
    "Edit your own unredacted, unexpired message",
    ok({
      message: object({ id: string, content: string, tags: { type: "object" }, editedAt: number }),
    }),
    {
      body: runtimeSchema("EditMessage", EditMessageSchema),
      description:
        "Ownership uses the immutable author account ID. A current channel membership is required. A client-provided senderNick cannot establish ownership.",
    },
  );
  operation(
    `${channel}/messages/{id}`,
    "delete",
    "Redact your message or moderate a channel message",
    ok({ id: string }),
    {
      description:
        "Current channel access plus author/moderator authority is required. Text, multiline payloads, tags and FTS entries are scrubbed.",
    },
  );
  schemas.SearchResult = ok({
    channels: array(string),
    channel: string,
    query: string,
    filters: { type: "object" },
    count: integer,
    items: array(object({ message: { type: "object" }, conversation: { type: "object" } })),
    nextCursor: nullableString,
    messages: array(ref("Message")),
  });
  schemas.SearchResult.required = [
    "ok",
    "query",
    "filters",
    "count",
    "items",
    "nextCursor",
    "messages",
  ];
  operation(
    `${channel}/messages/search`,
    "get",
    "Search authorized channel history",
    ref("SearchResult"),
    { parameters: searchParameters, description: channelPolicy },
  );
  operation("/api/v1/search", "get", "Search visible channel history", ref("SearchResult"), {
    parameters: [
      ...searchParameters,
      parameter("in", "query", { oneOf: [string, array(string)] }),
      parameter("conversationId", "query", { oneOf: [string, array(string)] }),
    ],
    description:
      "Explicit unauthorized channel scopes return 403. Broad searches omit inaccessible channels from results and the returned channel list. This endpoint does not search DMs.",
  });
  operation(
    "/api/v1/dms/{target}/messages",
    "get",
    "Read a direct conversation you participate in",
    ok({
      user: string,
      target: string,
      messages: array(ref("DirectMessage")),
      pagination: ref("Pagination"),
    }),
    {
      parameters: [
        ...historyParameters.filter((p) => p.name !== "around"),
        parameter(
          "user",
          "query",
          string,
          "Defaults to the authenticated account; caller must be one of the selected pair",
        ),
      ],
      description:
        "target and user identify registered account names, not proof of participation or reusable IRC nicknames. DMs are keyed by immutable account IDs. Administrators have no participant bypass. Redacted/expired records are excluded. Legacy nickname-keyed records are retained but quarantined from guessed ownership.",
    },
  );
  operation(
    `${channel}/roles`,
    "get",
    "Read authorized channel role definitions",
    ok({ roles: array(ref("Role")) }),
    { description: channelPolicy },
  );
  operation(
    `${channel}/roles`,
    "post",
    "Create a channel role as founder/administrator",
    ok({ role: ref("Role") }),
    { status: 201, body: runtimeSchema("CreateRole", CreateRoleGroupSchema) },
  );
  operation(
    `${channel}/roles/{id}`,
    "patch",
    "Update a channel role as founder/administrator",
    ok({ role: ref("Role") }),
    { body: runtimeSchema("UpdateRole", CreateRoleGroupSchema.partial()) },
  );
  operation(
    `${channel}/roles/{id}`,
    "delete",
    "Delete a role and cascade its assignments",
    object({ ok: boolean, id: string }),
  );
  operation(
    `${channel}/roles/assign`,
    "post",
    "Assign/remove an account's channel role",
    ok({ userId: string, roleGroupId: string, assigned: boolean }),
    {
      body: runtimeSchema("AssignRole", AssignUserRoleSchema),
      description:
        "Founder/administrator authority is required; userId selects the target account, never the caller. Role group and assignment remain scoped to this channel. Derived mode permissions are read from current persisted assignments.",
    },
  );
  operation(
    `${channel}/unread`,
    "get",
    "Read your authorized channel unread count",
    { allOf: [ref("Unread"), ok()] },
    {
      parameters: [
        parameter("username", "query", string, "Defaults to caller; must identify the caller"),
        parameter("user", "query", string, "Legacy username alias"),
      ],
      description: channelPolicy,
    },
  );
  operation(
    "/api/v1/users/{username}/unread",
    "get",
    "Read your visible-channel unread summaries",
    ok({ username: string, channels: array(ref("Unread")) }),
    {
      description:
        "Self only; inaccessible channel names/counts are omitted. Read markers are updated through authenticated IRC MARKREAD.",
    },
  );
  const level = { type: "string", enum: ["all", "mentions", "nothing"] };
  operation(
    "/api/v1/users/{username}/notifications",
    "get",
    "List your notification preferences",
    ok({
      username: string,
      notifications: array(
        object({ channel: string, level, muted: boolean, mutedUntil: nullableNumber }),
      ),
    }),
  );
  operation(
    "/api/v1/users/{username}/notifications/{channel}",
    "put",
    "Set your channel notification preference",
    ok({ username: string, channel: string, level, mutedUntil: nullableNumber }),
    {
      body: object({ level, muted_until: nullableNumber }, ["level"]),
      description:
        "Self only. This configures preferences; it does not promise an implemented external push delivery service.",
    },
  );
  operation(
    "/api/v1/notifications/subscribe",
    "post",
    "Store your HTTPS push subscription",
    ok({ registered: boolean, endpoint: string }),
    {
      body: runtimeSchema("Subscribe", WebPushSubscribeSchema),
      description:
        "Self only. Subscription persistence is implemented; encrypted WebPush delivery and configurable VAPID signing remain unimplemented.",
    },
  );
  operation(
    "/api/v1/notifications/subscribe",
    "delete",
    "Remove your push subscription",
    ok({ removed: boolean }),
    { parameters: [parameter("username"), parameter("endpoint")] },
  );
  operation(
    "/api/v1/notifications/subscriptions",
    "get",
    "List your push subscription endpoints",
    ok({ username: string, endpoints: array(string) }),
    { parameters: [parameter("username")] },
  );
  schemas.Upload = ok({
    id: string,
    url: string,
    filename: string,
    size: integer,
    mimeType: string,
    uploader: string,
  });
  operation(
    "/api/v1/media/upload",
    "post",
    "Upload private or explicitly scoped media",
    ref("Upload"),
    {
      status: 201,
      parameters: [
        parameter(
          "channel",
          "query",
          string,
          "Explicit channel scope; caller must be an authorized member",
        ),
        parameter("dm", "query", string, "Explicit recipient account; both accounts can read"),
        parameter("X-Filename", "header"),
      ],
      description:
        "No scope means uploader-only. Requires a logged-in API session; nickname/Basic headers do not authenticate. Maximum 10 MiB request and 100 MiB stored per account. R2 is private and accessed only after persisted scope checks. Unowned legacy files are quarantined.",
    },
  );
  paths["/api/v1/media/upload"].post.requestBody = {
    required: true,
    content: {
      "multipart/form-data": { schema: object({ file: { type: "string", format: "binary" } }) },
      "application/octet-stream": { schema: { type: "string", format: "binary" } },
      "image/png": { schema: { type: "string", format: "binary" } },
      "text/plain": { schema: { type: "string", format: "binary" } },
    },
  };
  operation(
    "/media/{id}",
    "get",
    "Download authorized media",
    {},
    {
      description:
        "Authentication and stored uploader/channel/DM scope are checked before R2/SQLite retrieval. Unauthorized or unknown files return 404. Responses use private no-store caching, nosniff, CSP sandbox and attachment disposition for active content.",
    },
  );
  paths["/media/{id}"].get.responses["200"] = {
    description: "Authorized file bytes",
    content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
  };
  operation("/api/v1/media/{id}", "delete", "Delete your uploaded media", ref("Ok"), {
    description:
      "Uploader only; unknown/not-owned returns 404. R2 deletion completes before access metadata is removed.",
  });
  operation(
    "/api/v1/embeds",
    "get",
    "Resolve metadata from an operator-allowed HTTPS host",
    ok({ embed: { type: "object" } }),
    {
      parameters: [parameter("url")],
      description:
        "Outbound previews are disabled without EMBED_ALLOWED_HOSTS. Each redirect and discovered oEmbed destination must also be allowed. Fetches have byte/time bounds; executable oEmbed HTML is not returned.",
    },
  );
  const hookBody = object(
    {
      content: { type: "string", maxLength: 4000 },
      username: { type: "string", maxLength: 32 },
      avatar_url: { type: "string", format: "uri" },
      embeds: array({ type: "object" }),
    },
    [],
  );
  operation(
    `${channel}/webhooks`,
    "post",
    "Create a channel-scoped incoming webhook capability",
    ok({ webhook: ref("Webhook") }),
    {
      status: 201,
      body: object(
        {
          name: { type: "string", minLength: 1, maxLength: 32 },
          avatar_url: { type: "string", format: "uri" },
        },
        ["name"],
      ),
      description:
        "Channel operator/founder/admin only. The creator comes from the authenticated account.",
    },
  );
  operation(
    `${channel}/webhooks`,
    "get",
    "List channel webhook capabilities",
    ok({ channel: string, webhooks: array(ref("Webhook")) }),
    {
      description:
        "Channel management permission required; response includes secret execution tokens.",
    },
  );
  operation(`${channel}/webhooks/{id}`, "delete", "Delete a channel webhook capability", ref("Ok"));
  operation(
    "/api/v1/webhooks/{token}",
    "post",
    "Execute a channel-scoped webhook capability",
    ok({ channel: string, messageId: string }),
    {
      public: true,
      tag: "Webhooks",
      body: hookBody,
      parameters: [parameter("channel", "query", { type: "string", default: "#general" })],
      description:
        "The path token is authentication for a narrowly scoped bot operation, not anonymous user access. Either content or embeds is required. The token must belong to the selected channel; archived channels revoke old hooks. IRC nicknames are namespaced as hook_* and the requested display name is a tag, never a registered account identity.",
    },
  );
  operation(
    `${channel}/outgoing-webhooks`,
    "post",
    "Configure an operator-allowed HTTPS outgoing hook",
    ok({ webhook: ref("OutgoingWebhook") }),
    {
      body: object(
        {
          target_url: { type: "string", format: "uri" },
          secret: { type: "string", maxLength: 128 },
          events: array(string),
        },
        ["target_url"],
      ),
      description:
        "Channel management permission and an explicit OUTGOING_WEBHOOK_ALLOWED_HOSTS match are required. Redirects are rejected. Delivery is best effort after storage commits; no durable retry/outbox guarantee is made.",
    },
  );
  operation(
    `${channel}/outgoing-webhooks`,
    "get",
    "List channel outgoing hooks",
    ok({ webhooks: array(ref("OutgoingWebhook")) }),
  );
  operation(
    `${channel}/outgoing-webhooks/{id}`,
    "delete",
    "Remove a channel outgoing hook",
    ref("Ok"),
  );

  const adminResult = object(
    {
      ok: boolean,
      channelName: string,
      message: string,
      error: string,
      recipientSessionIds: array(string),
    },
    ["ok"],
  );
  schemas.AdminResult = adminResult;
  const adminOperations: Array<[string, string, string, z.ZodType | undefined, any]> = [
    [
      "/config",
      "post",
      "Persist network runtime configuration",
      admin.AdminConfigSchema,
      ok({ config: { type: "object" } }),
    ],
    ["/stats", "get", "Inspect network statistics", undefined, { type: "object" }],
    [
      "/broadcast",
      "post",
      "Broadcast a network notice",
      admin.AdminBroadcastSchema.extend({
        notice: z.boolean().optional(),
        wallops: z.boolean().optional(),
      }),
      ok({ sentCount: integer }),
    ],
    [
      "/sessions",
      "get",
      "List live IRC sessions",
      undefined,
      ok({ sessions: array({ type: "object" }) }),
    ],
    [
      "/sessions/disconnect",
      "post",
      "Disconnect a selected IRC session",
      admin.AdminDisconnectSessionSchema,
      ref("AdminResult"),
    ],
    [
      "/accounts",
      "get",
      "List accounts including disabled status",
      undefined,
      ok({ accounts: array({ type: "object" }) }),
    ],
    [
      "/accounts",
      "post",
      "Provision an account with explicit roles",
      admin.AdminAccountCreateSchema,
      ok({ account: ref("Account") }),
    ],
    [
      "/accounts/disable",
      "post",
      "Disable an account and disconnect its sessions",
      z.object({ username: z.string() }),
      ref("AdminResult"),
    ],
    [
      "/accounts/{username}",
      "get",
      "Inspect account, nicknames and metadata",
      undefined,
      { type: "object" },
    ],
    [
      "/accounts/{username}",
      "patch",
      "Update explicit account fields",
      admin.AdminAccountUpdateSchema,
      ok({ account: ref("Account") }),
    ],
    [
      "/accounts/{username}",
      "delete",
      "Delete account-owned state; preserve channel history",
      undefined,
      ref("AdminResult"),
    ],
    [
      "/accounts/{username}/password",
      "post",
      "Atomically reset credentials and revoke sessions",
      admin.AdminPasswordSchema,
      ref("AdminResult"),
    ],
    [
      "/accounts/{username}/disable",
      "post",
      "Disable account and revoke sessions",
      undefined,
      ref("AdminResult"),
    ],
    [
      "/accounts/{username}/enable",
      "post",
      "Re-enable an account without restoring revoked credentials",
      undefined,
      ref("AdminResult"),
    ],
    [
      "/accounts/{username}/roles",
      "get",
      "Read assigned global roles",
      undefined,
      ok({ username: string, roles: array(string) }),
    ],
    [
      "/accounts/{username}/roles",
      "post",
      "Grant/revoke a global role",
      admin.AdminRoleSchema,
      ref("AdminResult"),
    ],
    [
      "/profile/{username}",
      "get",
      "Read an account profile",
      undefined,
      ok({ profile: ref("Profile") }),
    ],
    [
      "/profile/{username}",
      "patch",
      "Administratively update a profile",
      UserProfileInputSchema,
      ok({ profile: ref("Profile") }),
    ],
    [
      "/messages/redact",
      "post",
      "Redact a channel message",
      admin.AdminRedactSchema,
      object({ ok: boolean, msgId: string }),
    ],
    [
      "/channels",
      "get",
      "List channel inventory",
      undefined,
      ok({ channels: array({ type: "object" }) }),
    ],
    [
      "/channels/{channel}",
      "get",
      "Inspect full channel state",
      undefined,
      ok({ channel: { type: "object" } }),
    ],
    [
      "/channels/{channel}",
      "delete",
      "Archive a channel, optionally purge its messages",
      admin.AdminDestroySchema,
      object({
        ok: boolean,
        channelName: string,
        recipientSessionIds: array(string),
        purgedCount: integer,
      }),
    ],
    [
      "/channels/{channel}/info",
      "get",
      "Inspect channel metadata",
      undefined,
      ok({ channel: ref("Channel") }),
    ],
    [
      "/channels/{channel}/info",
      "patch",
      "Administratively update channel metadata",
      UpdateChannelInfoSchema,
      ok({ channel: ref("Channel") }),
    ],
    [
      "/channels/{channel}/register",
      "post",
      "Register an existing account as channel founder",
      admin.AdminRegisterChannelSchema,
      ref("AdminResult"),
    ],
    [
      "/channels/{channel}/unregister",
      "post",
      "Unregister a channel",
      undefined,
      ref("AdminResult"),
    ],
    [
      "/channels/{channel}/modes",
      "post",
      "Apply channel modes",
      admin.AdminModesSchema,
      ref("AdminResult"),
    ],
    [
      "/channels/{channel}/topic",
      "post",
      "Set a channel topic",
      admin.AdminTopicSchema,
      ref("AdminResult"),
    ],
    [
      "/channels/{channel}/kick",
      "post",
      "Remove a channel member",
      admin.AdminKickSchema,
      ref("AdminResult"),
    ],
    [
      "/channels/{channel}/bot",
      "get",
      "Inspect F bot configuration",
      undefined,
      ok({ channel: string, bot: { type: "object" } }),
    ],
    [
      "/channels/{channel}/bot",
      "post",
      "Configure the channel F bot",
      admin.AdminBotSchema,
      ok({ channel: string, bot: { type: "object" } }),
    ],
    [
      "/channels/{channel}/messages",
      "get",
      "Inspect stored channel records",
      undefined,
      ok({ channel: string, messages: array(ref("Message")) }),
    ],
    [
      "/channels/{channel}/messages/purge",
      "post",
      "Purge channel messages by an explicit boundary",
      admin.AdminPurgeSchema,
      ok({ channel: string, purgedCount: integer }),
    ],
  ];
  for (const kind of ["users", "channels"]) {
    adminOperations.push(
      [
        `/metadata/${kind}/{target}`,
        "get",
        "Inspect metadata",
        undefined,
        ok({ metadata: { type: "object" } }),
      ],
      [
        `/metadata/${kind}/{target}`,
        "put",
        "Set validated metadata entries",
        admin.AdminMetadataSchema,
        ref("AdminResult"),
      ],
      [
        `/metadata/${kind}/{target}/{key}`,
        "delete",
        "Remove a metadata entry",
        undefined,
        ref("AdminResult"),
      ],
    );
  }
  for (const [suffix, method, summary, body, response] of adminOperations) {
    const bodySchema = body
      ? runtimeSchema(`Admin_${method}_${suffix.replace(/[^a-zA-Z]/g, "_")}`, body)
      : undefined;
    operation(`/api/v1/admin${suffix}`, method, summary, response, {
      body: bodySchema,
      tag: "Administration",
      description:
        "Requires the current administrator role in addition to a logged-in account session. Static admin secrets, Basic authentication and user headers do not authorize this API. Request bodies are validated before optional-body defaults are applied.",
      status: suffix === "/accounts" && method === "post" ? 201 : 200,
    });
    paths[`/admin${suffix}`] = paths[`/api/v1/admin${suffix}`];
  }
  paths["/api/v1/admin/accounts/register"] = { post: paths["/api/v1/admin/accounts"].post };
  paths["/admin/accounts/register"] = { post: paths["/admin/accounts"].post };
  const aliases: Record<string, string> = {
    "/api/accounts/register": "/api/v1/auth/register",
    "/api/profile/{username}": profilePath,
    "/api/channels/{channel}/info": `${channel}/info`,
    "/api/channels/{channel}/unread": `${channel}/unread`,
    "/api/users/{username}/unread": "/api/v1/users/{username}/unread",
    "/api/media/upload": "/api/v1/media/upload",
    "/api/webpush/subscribe": "/api/v1/notifications/subscribe",
    "/api/webpush/subscriptions": "/api/v1/notifications/subscriptions",
    "/api/v1/messages/search": "/api/v1/search",
    "/api/health": "/health",
    "/api/status": "/status",
    "/api/v1/webhooks/{id}/{token}": "/api/v1/webhooks/{token}",
    "/api/webhooks/{id}/{token}": "/api/v1/webhooks/{token}",
  };
  for (const [alias, target] of Object.entries(aliases)) {
    paths[alias] = structuredClone(paths[target]);
    for (const value of Object.values(paths[alias]) as any[]) {
      value.description = `Legacy/compatibility alias of ${target}. ${value.description ?? ""}`;
      if (alias.includes("{id}"))
        value.parameters.unshift(parameter("id", "path", string, "Webhook identifier"));
    }
  }
  paths["/metrics"] = {
    get: {
      summary: "Authenticated Prometheus metrics",
      security: [{ SessionToken: [] }],
      responses: {
        "200": { description: "Prometheus text", content: { "text/plain": { schema: string } } },
        "401": { description: "Session required" },
      },
    },
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "FlaRC (Flare Relay Chat) API",
      version: SERVER_CONFIG.version,
      description:
        "Registered-account communications API. Read the security policy and verification limitations in docs/security before deployment.",
    },
    servers: [{ url: "/" }],
    security: [{ SessionToken: [] }],
    paths,
    components: {
      securitySchemes: {
        SessionToken: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "opaque 256-bit API session",
        },
        EventTicket: {
          type: "apiKey",
          in: "query",
          name: "ticket",
          description: "30-second single-use WebSocket ticket; never a reusable account credential",
        },
      },
      schemas,
    },
  };
}

export default defineEventHandler((event) => {
  getEnv(event);
  return generateOpenAPISpec();
});
