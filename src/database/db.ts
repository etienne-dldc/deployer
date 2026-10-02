import { Database } from "@db/sqlite";
import type { TOperation, TOperationResult } from "@dldc/zendb";
import { DbSqliteDriver } from "@dldc/zendb-db-sqlite";
import { Config } from "../logic/config/config.ts";
import { mountable } from "../utils/mountable.ts";
import { migration } from "./schema.ts";

export const Db = mountable(async () => {
  const { databasePath } = Config.get();
  const initDb = new Database(databasePath);

  const [migratedDb, shouldSave] = await migration.apply(initDb);
  let db = migratedDb;
  if (shouldSave) {
    const diskDb = new Database(databasePath);
    migratedDb.backup(diskDb);
    migratedDb.close();
    db = diskDb;
  }

  return {
    value: {
      db,
      exec<Op extends TOperation>(op: Op): TOperationResult<Op> {
        return DbSqliteDriver.exec(db, op);
      },
      execMany(ops: TOperation[]): TOperationResult<TOperation>[] {
        return DbSqliteDriver.execMany(db, ops);
      },
    },
    unmount() {
      db.close();
    },
  };
});
