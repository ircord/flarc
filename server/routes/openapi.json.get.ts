import { defineEventHandler } from "nitro/h3";
import { SERVER_CONFIG } from "../core/config";

export function generateOpenAPISpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "FlaRC (Flare Relay Chat) API",
      version: SERVER_CONFIG.version,
      description:
        "Modern API-first communications server with full IRC/IRCv3 compatibility, SQLite-backed Durable Objects, real-time events, and media hosting.",
    },
    servers: [
      {
        url: "/",
        description: "Current FlaRC server instance",
      },
    ],
    paths: {
      "/health": {
        get: {
          summary: "Server Health",
          tags: ["System"],
          responses: {
            "200": {
              description: "Server status",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      service: { type: "string" },
                      network: { type: "string" },
                      server: { type: "string" },
                      version: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/v1/auth/register": {
        post: {
          summary: "Register Account",
          tags: ["Auth"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RegisterRequest" },
              },
            },
          },
          responses: {
            "201": { description: "Registered successfully" },
            "400": { description: "Invalid input or account already exists" },
          },
        },
      },
      "/api/v1/auth/login": {
        post: {
          summary: "Verify Credentials",
          tags: ["Auth"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/LoginRequest" },
              },
            },
          },
          responses: {
            "200": { description: "Authentication successful" },
            "401": { description: "Invalid credentials" },
          },
        },
      },
      "/api/v1/profiles/{username}": {
        get: {
          summary: "Get User Profile",
          tags: ["Profiles"],
          parameters: [
            {
              name: "username",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Profile returned",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/UserProfile" },
                },
              },
            },
            "404": { description: "User not found" },
          },
        },
        patch: {
          summary: "Update User Profile",
          tags: ["Profiles"],
          parameters: [
            {
              name: "username",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UserProfileInput" },
              },
            },
          },
          responses: {
            "200": { description: "Profile updated" },
            "404": { description: "User not found" },
          },
        },
      },
      "/api/v1/channels": {
        get: {
          summary: "List Channels",
          tags: ["Channels"],
          responses: {
            "200": {
              description: "List of active channels",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      channels: {
                        type: "array",
                        items: { $ref: "#/components/schemas/ChannelSummary" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/v1/channels/{channel}/info": {
        get: {
          summary: "Get Channel Info",
          tags: ["Channels"],
          parameters: [
            {
              name: "channel",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Channel details",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ChannelInfo" },
                },
              },
            },
          },
        },
        patch: {
          summary: "Update Channel Info",
          tags: ["Channels"],
          parameters: [
            {
              name: "channel",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ChannelInfoUpdate" },
              },
            },
          },
          responses: {
            "200": { description: "Channel info updated" },
          },
        },
      },
      "/api/v1/channels/{channel}/unread": {
        get: {
          summary: "Get Channel Unread Summary",
          tags: ["Channels"],
          parameters: [
            { name: "channel", in: "path", required: true, schema: { type: "string" } },
            { name: "username", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "Unread count and mention summary",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/UnreadSummary" },
                },
              },
            },
          },
        },
      },
      "/api/v1/channels/{channel}/roles": {
        get: {
          summary: "List Channel Role Groups",
          tags: ["Roles"],
          parameters: [{ name: "channel", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description: "List of role groups",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      roles: {
                        type: "array",
                        items: { $ref: "#/components/schemas/RoleGroup" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          summary: "Create Channel Role Group",
          tags: ["Roles"],
          parameters: [{ name: "channel", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateRoleGroupRequest" },
              },
            },
          },
          responses: {
            "201": { description: "Role group created" },
          },
        },
      },
      "/api/v1/channels/{channel}/roles/{id}": {
        patch: {
          summary: "Update Channel Role Group",
          tags: ["Roles"],
          parameters: [
            { name: "channel", in: "path", required: true, schema: { type: "string" } },
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateRoleGroupRequest" },
              },
            },
          },
          responses: {
            "200": { description: "Role group updated" },
            "404": { description: "Role group not found" },
          },
        },
        delete: {
          summary: "Delete Channel Role Group",
          tags: ["Roles"],
          parameters: [
            { name: "channel", in: "path", required: true, schema: { type: "string" } },
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Role group deleted" },
          },
        },
      },
      "/api/v1/channels/{channel}/roles/assign": {
        post: {
          summary: "Assign Role to User",
          tags: ["Roles"],
          parameters: [{ name: "channel", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["userId", "roleGroupId"],
                  properties: {
                    userId: { type: "string" },
                    roleGroupId: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Role assigned" },
          },
        },
      },
      "/api/v1/channels/{channel}/messages": {
        get: {
          summary: "Get Channel Messages",
          tags: ["Messages"],
          parameters: [
            { name: "channel", in: "path", required: true, schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
            { name: "before", in: "query", schema: { type: "string" } },
            { name: "after", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "List of messages",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      messages: {
                        type: "array",
                        items: { $ref: "#/components/schemas/StoredMessage" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          summary: "Send Message",
          tags: ["Messages"],
          parameters: [{ name: "channel", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SendMessageRequest" },
              },
            },
          },
          responses: {
            "201": { description: "Message sent" },
          },
        },
      },
      "/api/v1/channels/{channel}/messages/{id}": {
        patch: {
          summary: "Edit Message",
          tags: ["Messages"],
          parameters: [
            { name: "channel", in: "path", required: true, schema: { type: "string" } },
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["content"],
                  properties: {
                    content: { type: "string" },
                    senderNick: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Message edited" },
            "403": { description: "Forbidden" },
            "404": { description: "Message not found" },
          },
        },
        delete: {
          summary: "Redact Message",
          tags: ["Messages"],
          parameters: [
            { name: "channel", in: "path", required: true, schema: { type: "string" } },
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Message redacted" },
          },
        },
      },
      "/api/v1/channels/{channel}/messages/search": {
        get: {
          summary: "Search Channel Messages (FTS5 & Filter Tags)",
          tags: ["Messages"],
          parameters: [
            { name: "channel", in: "path", required: true, schema: { type: "string" } },
            { name: "q", in: "query", schema: { type: "string" } },
            { name: "from", in: "query", schema: { type: "string" } },
            { name: "mentions", in: "query", schema: { type: "string" } },
            {
              name: "has",
              in: "query",
              schema: { type: "string", enum: ["link", "image", "gif", "video", "file"] },
            },
            { name: "before", in: "query", schema: { type: "string" } },
            { name: "after", in: "query", schema: { type: "string" } },
            { name: "on", in: "query", schema: { type: "string" } },
            { name: "author", in: "query", schema: { type: "string", enum: ["user", "bot"] } },
            { name: "tag", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
          ],
          responses: {
            "200": {
              description: "Matching messages returned",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      channel: { type: "string" },
                      query: { type: "string" },
                      filters: { type: "object" },
                      count: { type: "integer" },
                      messages: {
                        type: "array",
                        items: { $ref: "#/components/schemas/StoredMessage" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/v1/messages/search": {
        get: {
          summary: "Global Cross-Channel Message Search",
          tags: ["Messages"],
          parameters: [
            { name: "q", in: "query", schema: { type: "string" } },
            { name: "in", in: "query", schema: { type: "string" } },
            { name: "from", in: "query", schema: { type: "string" } },
            { name: "mentions", in: "query", schema: { type: "string" } },
            {
              name: "has",
              in: "query",
              schema: { type: "string", enum: ["link", "image", "gif", "video", "file"] },
            },
            { name: "before", in: "query", schema: { type: "string" } },
            { name: "after", in: "query", schema: { type: "string" } },
            { name: "on", in: "query", schema: { type: "string" } },
            { name: "author", in: "query", schema: { type: "string", enum: ["user", "bot"] } },
            { name: "tag", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
          ],
          responses: {
            "200": {
              description: "Matching messages returned across channels",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      channels: { type: "array", items: { type: "string" } },
                      query: { type: "string" },
                      filters: { type: "object" },
                      count: { type: "integer" },
                      messages: {
                        type: "array",
                        items: { $ref: "#/components/schemas/StoredMessage" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/v1/channels/{channel}/webhooks": {
        get: {
          summary: "List Channel Webhooks",
          tags: ["Webhooks"],
          parameters: [{ name: "channel", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Webhooks list" },
          },
        },
        post: {
          summary: "Create Incoming Webhook",
          tags: ["Webhooks"],
          parameters: [{ name: "channel", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name"],
                  properties: {
                    name: { type: "string" },
                    avatar_url: { type: "string" },
                    created_by: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Webhook created" },
          },
        },
      },
      "/api/v1/channels/{channel}/webhooks/{id}": {
        delete: {
          summary: "Delete Webhook",
          tags: ["Webhooks"],
          parameters: [
            { name: "channel", in: "path", required: true, schema: { type: "string" } },
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Webhook deleted" },
          },
        },
      },
      "/api/v1/webhooks/{token}": {
        post: {
          summary: "Execute Incoming Webhook (Discord/Slack Compatible)",
          tags: ["Webhooks"],
          parameters: [
            { name: "token", in: "path", required: true, schema: { type: "string" } },
            { name: "channel", in: "query", schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["content"],
                  properties: {
                    content: { type: "string" },
                    username: { type: "string" },
                    avatar_url: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Webhook executed and message dispatched" },
            "400": { description: "Invalid token or payload" },
          },
        },
      },
      "/api/v1/users/{username}/unread": {
        get: {
          summary: "Get User Multi-Channel Unread Summary",
          tags: ["Channels"],
          parameters: [
            { name: "username", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "Unread summaries for all channels",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      username: { type: "string" },
                      channels: {
                        type: "array",
                        items: { $ref: "#/components/schemas/UnreadSummary" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/v1/media/upload": {
        post: {
          summary: "Upload Media File",
          tags: ["Media"],
          description:
            "Upload media using multipart/form-data or raw octet-stream with X-Filename header.",
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    file: { type: "string", format: "binary" },
                  },
                },
              },
              "application/octet-stream": {
                schema: { type: "string", format: "binary" },
              },
            },
          },
          responses: {
            "201": {
              description: "Uploaded successfully",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/MediaUploadResponse" },
                },
              },
            },
            "401": { description: "Unauthorized" },
            "403": { description: "File hosting disabled" },
          },
        },
      },
      "/media/{id}": {
        get: {
          summary: "Get Media File",
          tags: ["Media"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description: "File content",
              content: {
                "application/octet-stream": {
                  schema: { type: "string", format: "binary" },
                },
              },
            },
            "404": { description: "File not found" },
          },
        },
      },
      "/api/v1/notifications/subscribe": {
        post: {
          summary: "Subscribe to WebPush",
          tags: ["Notifications"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["username", "endpoint"],
                  properties: {
                    username: { type: "string" },
                    endpoint: { type: "string" },
                    keys: {
                      type: "object",
                      properties: {
                        p256dh: { type: "string" },
                        auth: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Subscribed successfully" },
          },
        },
        delete: {
          summary: "Unsubscribe from WebPush",
          tags: ["Notifications"],
          parameters: [
            { name: "username", in: "query", required: true, schema: { type: "string" } },
            { name: "endpoint", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Unsubscribed successfully" },
          },
        },
      },
      "/api/v1/notifications/subscriptions": {
        get: {
          summary: "List Subscriptions for User",
          tags: ["Notifications"],
          parameters: [
            { name: "username", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "List of endpoints",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      username: { type: "string" },
                      endpoints: { type: "array", items: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/v1/events": {
        get: {
          summary: "Real-time Event Stream (WebSocket)",
          tags: ["Events"],
          description: "WebSocket connection streaming typed application domain events.",
          responses: {
            "101": { description: "WebSocket connection established" },
          },
        },
      },
    },
    components: {
      schemas: {
        RegisterRequest: {
          type: "object",
          required: ["username", "password"],
          properties: {
            username: { type: "string", minLength: 1, maxLength: 32 },
            password: { type: "string", minLength: 1 },
            displayName: { type: "string" },
            roles: { type: "array", items: { type: "string" } },
          },
        },
        LoginRequest: {
          type: "object",
          required: ["username", "password"],
          properties: {
            username: { type: "string" },
            password: { type: "string" },
          },
        },
        UserProfile: {
          type: "object",
          properties: {
            username: { type: "string" },
            displayName: { type: "string", nullable: true },
            avatar: { type: "string", nullable: true },
            bio: { type: "string", nullable: true },
            pronouns: { type: "string", nullable: true },
            color: { type: "string", nullable: true },
            url: { type: "string", nullable: true },
            bot: { type: "boolean" },
          },
        },
        UserProfileInput: {
          type: "object",
          properties: {
            displayName: { type: "string", nullable: true },
            avatar: { type: "string", nullable: true },
            bio: { type: "string", nullable: true },
            pronouns: { type: "string", nullable: true },
            color: { type: "string", nullable: true },
            url: { type: "string", nullable: true },
            bot: { type: "boolean" },
          },
        },
        ChannelSummary: {
          type: "object",
          properties: {
            channelName: { type: "string" },
            canonicalChannel: { type: "string" },
            userCount: { type: "integer" },
          },
        },
        ChannelInfo: {
          type: "object",
          properties: {
            channel: { type: "string" },
            canonicalName: { type: "string" },
            topic: { type: "string", nullable: true },
            topicSetBy: { type: "string", nullable: true },
            topicSetAt: { type: "integer", nullable: true },
            modes: { type: "string" },
            registered: { type: "boolean" },
            founder: { type: "string", nullable: true },
            registeredAt: { type: "integer", nullable: true },
            avatar: { type: "string", nullable: true },
            description: { type: "string", nullable: true },
            category: { type: "string", nullable: true },
            color: { type: "string", nullable: true },
            readOnly: { type: "boolean" },
            memberCount: { type: "integer" },
            createdAt: { type: "integer" },
            tags: { type: "array", items: { type: "string" } },
            nsfw: { type: "boolean" },
          },
        },
        ChannelInfoUpdate: {
          type: "object",
          properties: {
            avatar: { type: "string", nullable: true },
            description: { type: "string", nullable: true },
            category: { type: "string", nullable: true },
            color: { type: "string", nullable: true },
            readOnly: { type: "boolean", nullable: true },
            topic: { type: "string", nullable: true },
            tags: { type: "array", items: { type: "string" } },
            nsfw: { type: "boolean" },
          },
        },
        UnreadSummary: {
          type: "object",
          properties: {
            channel: { type: "string" },
            username: { type: "string", nullable: true },
            unreadCount: { type: "integer" },
            mentionCount: { type: "integer" },
            lastMessageId: { type: "string", nullable: true },
            lastMessageTime: { type: "integer", nullable: true },
            lastReadTimestamp: { type: "string", nullable: true },
          },
        },
        RoleGroup: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            color: { type: "string", nullable: true },
            position: { type: "integer" },
            ircMode: { type: "string", nullable: true },
            permissions: { type: "object" },
            createdAt: { type: "integer" },
            updatedAt: { type: "integer" },
          },
        },
        CreateRoleGroupRequest: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
            color: { type: "string" },
            position: { type: "integer" },
            ircMode: { type: "string" },
            permissions: { type: "object" },
          },
        },
        SendMessageRequest: {
          type: "object",
          required: ["content"],
          properties: {
            content: { type: "string" },
            senderNick: { type: "string" },
            tags: { type: "object" },
          },
        },
        StoredMessage: {
          type: "object",
          properties: {
            id: { type: "string" },
            sequence: { type: "integer" },
            senderNick: { type: "string" },
            content: { type: "string" },
            tags: { type: "object" },
            timestamp: { type: "integer" },
          },
        },
        MediaUploadResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            id: { type: "string" },
            url: { type: "string" },
            filename: { type: "string" },
            size: { type: "integer" },
            mimeType: { type: "string" },
            uploader: { type: "string" },
          },
        },
      },
    },
  };
}

export default defineEventHandler(() => {
  return generateOpenAPISpec();
});
