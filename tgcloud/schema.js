import { table, text, integer, index, primaryKey } from "sdk/db";

/**
 * Three tables: a key-value map, the conversation, and nothing else.
 *
 * The heart deliberately does not own users, chats, reports or roles — those
 * belong to the abilities deployment. If this app were deleted tomorrow, the
 * other one would still run.
 */
export const kvState = table("kv_state", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: integer("updated_at").notNull(),
});

export const aiMemory = table(
  "ai_memory",
  {
    chatId: text("chat_id").notNull(),
    userId: text("user_id").notNull(),
    messages: text("messages").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    aiMemoryPk: primaryKey({ columns: [t.chatId, t.userId] }),
    aiMemoryUpdatedIdx: index("idx_ai_memory_updated").on(t.updatedAt),
  }),
);

export const settings = table("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: integer("updated_at").notNull(),
});
