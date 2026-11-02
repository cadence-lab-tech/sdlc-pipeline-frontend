import {useEffect, useState} from 'react';

// «Сейчас» для относительного времени строки: обновляется раз в минуту, чтобы
// «движение 5 минут назад» не застывало на открытой странице. Меньше минуты
// строка не показывает, чаще обновлять незачем.
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
