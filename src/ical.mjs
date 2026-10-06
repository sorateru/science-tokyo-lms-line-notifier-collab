export async function fetchIcalTasks(config, now = Date.now(), fetchImpl = fetch) {
  if (!config.moodleIcalUrl) throw new Error('MOODLE_ICAL_URL を設定してください');
  const calendarUrl = normalizeIcalUrl(config.moodleIcalUrl);
  const response = await fetchImpl(calendarUrl, {
    headers: {
      Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.8',
      'Accept-Language': 'ja,en-US;q=0.8,en;q=0.7',
      // Some university WAFs reject non-browser user agents even for public
      // token-authenticated calendar exports.
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15'
    },
    redirect: 'follow'
  });
  if (!response.ok) {
    const hint = response.status === 403
      ? '（「カレンダーURLを取得」で生成したURLか、プライベートウインドウでも開けるか確認してください）'
      : '';
    throw new Error(`LMS calendar error: HTTP ${response.status}${hint}`);
  }
  const contentType = response.headers?.get?.('content-type') || '';
  const text = await response.text();
  if (!text.includes('BEGIN:VCALENDAR')) {
    const hint = contentType.includes('text/html') ? '（ログインページが返されました）' : '';
    throw new Error(`有効なiCalendarデータではありません${hint}`);
  }
  return parseIcalTasks(text, config.timezone || 'Asia/Tokyo')
    .filter(task => task.dueAt >= now - 86_400_000);
}

export function inspectIcalUrl(value) {
  const normalized = normalizeIcalUrl(value);
  let url;
  try {
    url = new URL(normalized);
  } catch {
    return { valid: false, reason: 'URLとして読み取れません' };
  }
  if (!['https:', 'http:'].includes(url.protocol)) {
    return { valid: false, reason: 'httpまたはhttpsのURLではありません' };
  }
  const isExportExecute = url.pathname.endsWith('/calendar/export_execute.php');
  const hasAuthToken = url.searchParams.has('authtoken');
  const hasUser = url.searchParams.has('userid') || url.searchParams.has('username');
  return {
    valid: isExportExecute && hasAuthToken && hasUser,
    isExportExecute,
    hasAuthToken,
    hasUser,
    normalizedAmpersand: String(value).includes('&amp;')
  };
}

function normalizeIcalUrl(value) {
  return String(value).trim().replace(/&amp;/gi, '&');
}

export function parseIcalTasks(ics, defaultTimezone = 'Asia/Tokyo') {
  const unfolded = ics.replace(/\r?\n[ \t]/g, '');
  const blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  return blocks.map((block, index) => parseEvent(block, index, defaultTimezone))
    .filter(Boolean);
}

function parseEvent(block, index, defaultTimezone) {
  const properties = new Map();
  for (const line of block.split(/\r?\n/).slice(1, -1)) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const head = line.slice(0, separator);
    const value = line.slice(separator + 1);
    const [name, ...parameters] = head.split(';');
    const params = Object.fromEntries(parameters.map(parameter => {
      const equals = parameter.indexOf('=');
      return equals < 0 ? [parameter.toUpperCase(), ''] : [
        parameter.slice(0, equals).toUpperCase(),
        parameter.slice(equals + 1).replace(/^"|"$/g, '')
      ];
    }));
    properties.set(name.toUpperCase(), { value, params });
  }

  const start = properties.get('DTSTART');
  const summary = decodeText(properties.get('SUMMARY')?.value || '名称未設定の予定');
  if (!start) return null;
  const dueAt = parseIcsDate(start.value, start.params.TZID || defaultTimezone);
  if (!Number.isFinite(dueAt)) return null;
  const description = decodeText(properties.get('DESCRIPTION')?.value || '');
  const explicitUrl = decodeText(properties.get('URL')?.value || '');
  const descriptionUrl = description.match(/https?:\/\/[^\s<>]+/)?.[0] || '';
  const uid = decodeText(properties.get('UID')?.value || `${dueAt}:${summary}:${index}`);
  return {
    externalId: `ical:${uid}`,
    source: 'moodle-ical',
    course: decodeText(properties.get('CATEGORIES')?.value || '').split(',')[0],
    title: summary,
    dueAt,
    url: explicitUrl || descriptionUrl,
    reminderOffsets: [1440, 720, 180],
    repeatIntervalMinutes: 0,
    repeatWindowMinutes: 1440
  };
}

function parseIcsDate(value, timezone) {
  if (/^\d{8}$/.test(value)) {
    return zonedTimestamp(`${value}T000000`, timezone);
  }
  if (/^\d{8}T\d{6}Z$/.test(value)) {
    const parts = dateParts(value);
    return Date.UTC(...parts);
  }
  if (/^\d{8}T\d{6}$/.test(value)) return zonedTimestamp(value, timezone);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function zonedTimestamp(value, timezone) {
  const parts = dateParts(value);
  const desired = Date.UTC(...parts);
  let guess = desired;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const shown = partsInZone(guess, timezone);
    const shownTimestamp = Date.UTC(
      shown.year, shown.month - 1, shown.day, shown.hour, shown.minute, shown.second
    );
    guess += desired - shownTimestamp;
  }
  return guess;
}

function dateParts(value) {
  return [
    Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1,
    Number(value.slice(6, 8)), Number(value.slice(9, 11)),
    Number(value.slice(11, 13)), Number(value.slice(13, 15))
  ];
}

function partsInZone(timestamp, timezone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  return Object.fromEntries(formatter.formatToParts(new Date(timestamp))
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, Number(part.value)]));
}

function decodeText(value) {
  return value
    .replace(/\\[nN]/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}
