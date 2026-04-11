function setLoggerClient() {}

function log() {}

function logInfo(scope, message, meta, options) {
  log("INFO", scope, message, meta, options);
}

function logWarn(scope, message, meta, options) {
  log("WARN", scope, message, meta, options);
}

function logError(scope, message, meta, options) {
  log("ERROR", scope, message, meta, options);
}

module.exports = {
  setLoggerClient,
  logInfo,
  logWarn,
  logError
};
