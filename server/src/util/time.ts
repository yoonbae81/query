/** UTC 저장 시각을 표시용 시간대(기본 KST)로 변환한다. */

interface Parts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
  offset: string;
}

function parts(date: Date, timeZone: string): Parts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "longOffset",
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) map[p.type] = p.value;
  const rawOffset = map.timeZoneName ?? "GMT";
  const offset = rawOffset === "GMT" ? "+00:00" : rawOffset.replace("GMT", "");
  return {
    year: map.year!,
    month: map.month!,
    day: map.day!,
    hour: map.hour!,
    minute: map.minute!,
    second: map.second!,
    offset,
  };
}

/** `2026-09-25T19:00:00+09:00` */
export function formatIso(date: Date, timeZone: string): string {
  const p = parts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${p.offset}`;
}

/** `250925` (yyMMdd) */
export function formatYyMMdd(date: Date, timeZone: string): string {
  const p = parts(date, timeZone);
  return `${p.year.slice(2)}${p.month}${p.day}`;
}
