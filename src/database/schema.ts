import { Column, Migration, Schema } from "@dldc/zendb";
import { DbSqliteDriver } from "@dldc/zendb-db-sqlite";

const baseSchema = Schema.declare({
  todo: {
    id: Column.text().primary(),
  },
});

export const migration = Migration.init(
  DbSqliteDriver,
  baseSchema,
  ({ database }) => {
    return database;
  },
);
