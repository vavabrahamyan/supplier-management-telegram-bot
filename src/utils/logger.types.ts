export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface Logger {
  debug(label: string, message: string): void;
  info(label: string, message: string): void;
  warn(label: string, message: string): void;
  error(label: string, message: string): void;
}
