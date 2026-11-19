import type { Logger, LogLevel } from './logger.types.ts';

const priorities: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

// Only fixed, application-authored messages belong in logs; external errors may contain credentials.
export function createLogger(level: LogLevel): Logger {
  const write = (severity: LogLevel, label: string, message: string): void => {
    if (priorities[severity] < priorities[level]) return;
    const line = `${new Date().toISOString()} ${severity.toUpperCase()} [${label}] ${message}`;
    if (severity === 'error') console.error(line);
    else if (severity === 'warn') console.warn(line);
    else console.log(line);
  };
  return {
    debug: (label, message) => write('debug', label, message),
    info: (label, message) => write('info', label, message),
    warn: (label, message) => write('warn', label, message),
    error: (label, message) => write('error', label, message),
  };
}
