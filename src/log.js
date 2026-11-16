// Одна строка JSON на событие. В поля не передаются токен бота и данные заявителя.
export function log(level, event, fields = {}) {
  if (process.env.LOG_LEVEL === 'silent') return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...fields });
  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
}
