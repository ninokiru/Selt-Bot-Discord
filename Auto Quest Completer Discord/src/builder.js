const DEFAULT_CLIENT = {
  clientVersion: '1.0.9175',
  electronVersion: '32.2.7',
  chromeVersion: '128.0.6613.186',
  osVersion: '10.0.26100',
  nativeBuildNumber: 59498,
};

const DEFAULT_BUILD_NUMBER = 504649;

const TZ_BY_COUNTRY = {
  US: 'America/New_York',
  CA: 'America/Toronto',
  GB: 'Europe/London',
  DE: 'Europe/Berlin',
  FR: 'Europe/Paris',
  NL: 'Europe/Amsterdam',
  JP: 'Asia/Tokyo',
  KR: 'Asia/Seoul',
  SG: 'Asia/Singapore',
  HK: 'Asia/Hong_Kong',
  TW: 'Asia/Taipei',
  CN: 'Asia/Shanghai',
  VN: 'Asia/Ho_Chi_Minh',
  TH: 'Asia/Bangkok',
  ID: 'Asia/Jakarta',
  PH: 'Asia/Manila',
  MY: 'Asia/Kuala_Lumpur',
  IN: 'Asia/Kolkata',
  AU: 'Australia/Sydney',
  BR: 'America/Sao_Paulo',
  AR: 'America/Argentina/Buenos_Aires',
  MX: 'America/Mexico_City',
  RU: 'Europe/Moscow',
  TR: 'Europe/Istanbul',
  PL: 'Europe/Warsaw',
  ES: 'Europe/Madrid',
  IT: 'Europe/Rome',
  SE: 'Europe/Stockholm',
  NO: 'Europe/Oslo',
  FI: 'Europe/Helsinki',
  DK: 'Europe/Copenhagen',
  CH: 'Europe/Zurich',
  AT: 'Europe/Vienna',
  BE: 'Europe/Brussels',
  IE: 'Europe/Dublin',
  PT: 'Europe/Lisbon',
  CZ: 'Europe/Prague',
  RO: 'Europe/Bucharest',
  UA: 'Europe/Kyiv',
  ZA: 'Africa/Johannesburg',
  EG: 'Africa/Cairo',
  NG: 'Africa/Lagos',
  AE: 'Asia/Dubai',
  SA: 'Asia/Riyadh',
  IL: 'Asia/Jerusalem',
  PK: 'Asia/Karachi',
  BD: 'Asia/Dhaka',
  NZ: 'Pacific/Auckland',
};

export function timezoneForCountry(countryCode) {
  if (!countryCode) return 'Asia/Ho_Chi_Minh';
  return TZ_BY_COUNTRY[String(countryCode).toUpperCase()] || 'Asia/Ho_Chi_Minh';
}

function safeInt(v, fallback) {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function safeStr(v, fallback) {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

export function buildSuperProperties(buildNumber, clientInfo = {}) {
  const clientVersion = safeStr(clientInfo.clientVersion, DEFAULT_CLIENT.clientVersion);
  const electronVersion = safeStr(clientInfo.electronVersion, DEFAULT_CLIENT.electronVersion);
  const chromeVersion = safeStr(clientInfo.chromeVersion, DEFAULT_CLIENT.chromeVersion);
  const osVersion = safeStr(clientInfo.osVersion, DEFAULT_CLIENT.osVersion);
  const nativeBuildNumber = safeInt(clientInfo.nativeBuildNumber, DEFAULT_CLIENT.nativeBuildNumber);
  const clientBuildNumber = safeInt(buildNumber, DEFAULT_BUILD_NUMBER);

  const ua =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    `(KHTML, like Gecko) discord/${clientVersion} Chrome/${chromeVersion} ` +
    `Electron/${electronVersion} Safari/537.36`;

  const obj = {
    os: 'Windows',
    browser: 'Discord Client',
    release_channel: 'stable',
    client_version: clientVersion,
    os_version: osVersion,
    os_arch: 'x64',
    app_arch: 'x64',
    system_locale: 'en-US',
    browser_user_agent: ua,
    browser_version: electronVersion,
    client_build_number: clientBuildNumber,
    native_build_number: nativeBuildNumber,
    client_event_source: null,
  };

  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
}

export function buildHeaders({ token, buildNumber, userAgent, clientInfo, timezone }) {
  const tz = timezone || 'Asia/Ho_Chi_Minh';
  const chromeVersion = safeStr(clientInfo?.chromeVersion, DEFAULT_CLIENT.chromeVersion);
  const majorChrome = parseInt(chromeVersion.split('.')[0], 10) || 0;

  return {
    Authorization: token,
    'Content-Type': 'application/json',
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent': userAgent,

    'X-Super-Properties': buildSuperProperties(buildNumber, clientInfo),
    'X-Discord-Locale': 'en-US',
    'X-Discord-Timezone': tz,

    'X-Debug-Options': 'bugReporterEnabled',

    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',

    Priority: `u=${majorChrome >= 128 ? 1 : 3}, i`,

    Origin: 'https://discord.com',
    Referer: 'https://discord.com/channels/@me',
  };
}

export function buildHeadersFor(api) {
  if (!api?.http?.defaults?.headers) return null;
  try {
    return JSON.parse(JSON.stringify(api.http.defaults.headers));
  } catch {
    return null;
  }
}