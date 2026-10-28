import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";
export const analysisDesks = pgTable("analysis_desks", {
  id: text("id").primaryKey(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
