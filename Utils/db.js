const fs = require("fs");
const path = require("path");
const { QuickDB } = require("quick.db");
const { logInfo, logWarn, logError } = require("./logger");

const sqlitePath = path.join(__dirname, "..", "database.sqlite");
const legacyJsonPath = path.join(__dirname, "..", "database.json");
const quickDb = new QuickDB({ filePath: sqlitePath });

async function migrateLegacyJson() {
  if (!fs.existsSync(legacyJsonPath)) {
    return;
  }

  try {
    const alreadyMigrated = await quickDb.get("__meta.legacyJsonMigrated");
    if (alreadyMigrated) {
      return;
    }

    const raw = fs.readFileSync(legacyJsonPath, "utf8");
    const parsed = raw.trim() ? JSON.parse(raw) : {};

    for (const [key, value] of Object.entries(parsed)) {
      await quickDb.set(key, value);
    }

    await quickDb.set("__meta.legacyJsonMigrated", true);
    fs.renameSync(legacyJsonPath, `${legacyJsonPath}.migrated`);
    logInfo("DB", "Migration database.json -> database.sqlite terminée");
  } catch (error) {
    logWarn("DB", "Migration legacy ignorée", error);
  }
}

const dbReady = migrateLegacyJson().catch((error) => {
  logError("DB", "Initialisation quick.db échouée", error);
});

const db = {
  async get(key) {
    await dbReady;
    return quickDb.get(key);
  },
  async set(key, value) {
    await dbReady;
    return quickDb.set(key, value);
  }
};

module.exports = { db, dbReady };
