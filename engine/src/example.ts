// Seed example schema (decisions.md #4): the first-run experience
// starts here instead of a blank screen. A small web-shop schema was
// picked because everyone can read it, and it exercises every feature
// the model supports: composite primary key (order_items), foreign
// keys, a unique non-PK column (users.email), text length limits, and
// a nullable column.

import type { Schema } from "./types.ts";

export const EXAMPLE_SCHEMA: Schema = {
  tables: [
    {
      name: "users",
      columns: [
        { name: "id", type: "unique-id", nullable: false },
        {
          name: "email",
          type: "text",
          nullable: false,
          unique: true,
          maxLength: 255,
        },
        { name: "display_name", type: "text", nullable: false, maxLength: 100 },
        { name: "created_at", type: "date-time", nullable: false },
      ],
      primaryKey: ["id"],
    },
    {
      name: "products",
      columns: [
        { name: "id", type: "whole-number", nullable: false },
        { name: "sku", type: "text", nullable: false, unique: true, maxLength: 40 },
        { name: "name", type: "text", nullable: false, maxLength: 200 },
        { name: "price", type: "decimal-number", nullable: false },
        { name: "in_stock", type: "true-false", nullable: false },
      ],
      primaryKey: ["id"],
    },
    {
      name: "orders",
      columns: [
        { name: "id", type: "whole-number", nullable: false },
        { name: "user_id", type: "unique-id", nullable: false },
        { name: "placed_at", type: "date-time", nullable: false },
        { name: "note", type: "text", nullable: true },
      ],
      primaryKey: ["id"],
      foreignKeys: [
        { column: "user_id", references: { table: "users", column: "id" } },
      ],
    },
    {
      name: "order_items",
      columns: [
        { name: "order_id", type: "whole-number", nullable: false },
        { name: "product_id", type: "whole-number", nullable: false },
        { name: "quantity", type: "whole-number-small", nullable: false },
      ],
      primaryKey: ["order_id", "product_id"],
      foreignKeys: [
        { column: "order_id", references: { table: "orders", column: "id" } },
        { column: "product_id", references: { table: "products", column: "id" } },
      ],
    },
  ],
};
