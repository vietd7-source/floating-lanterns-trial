function timestamp() {
  return new Date().toISOString();
}

function format(level, message) {
  return `[${timestamp()}] [${level}] ${message}`;
}

export const logger = {
  info(message) {
    console.log(format('INFO', message));
  },
  warn(message) {
    console.warn(format('WARN', message));
  },
  error(message) {
    console.error(format('ERROR', message));
  },
};
