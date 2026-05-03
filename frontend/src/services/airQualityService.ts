import { AirQualityData, AlertEmailSettings, DeviceAlert } from '../types';
import { sessionCacheFetch } from './sessionCache';

export type TimeWindow = '6h' | '12h' | '1d' | '1w';

const ALERTS_TTL_MS = 10 * 1000;

const getHistoryTtlMs = (window: TimeWindow): number => {
  switch (window) {
    case '6h':
      return 5 * 60 * 1000; // refresh more often (smaller query)
    case '12h':
      return 60 * 60 * 1000;
    case '1d':
      return 60 * 60 * 1000;
    case '1w':
      return 60 * 60 * 1000;
  }
};

const HISTORY_CACHE_PREFIX = 'piaq:devices:history:v1:';
const ALERTS_CACHE_PREFIX = 'piaq:devices:alerts:v1:';
const LATEST_CACHE_PREFIX = 'piaq:devices:latest:v1:';

type BackendMetricName = 'co2' | 'voc' | 'pm1_0' | 'pm2_5' | 'pm10' | 'temperature' | 'humidity';

type BackendHistoryPoint = {
  timestamp: string;
  avg: number;
  min: number;
  max: number;
};

type BackendHistoryResponse =
  | {
      deviceId: string;
      range: { start: string; end: string; bucket: string };
      metric: BackendMetricName;
      points: BackendHistoryPoint[];
    }
  | {
      deviceId: string;
      range: { start: string; end: string; bucket: string };
      metrics: Record<BackendMetricName, BackendHistoryPoint[]>;
    };

type BackendLatestResponse = {
  deviceId: string;
  latest: null | {
    windowStart: string;
    windowEnd: string;
    sampleCount: number;
    metrics: Record<
      BackendMetricName,
      {
        avg: number;
        max: number;
      }
    >;
  };
};

const API_BASE = (import.meta as any).env?.VITE_API_URL || '';

const toIso = (d: Date) => d.toISOString();

const getWindowConfig = (window: TimeWindow) => {
  switch (window) {
    case '6h':
      return { label: 'Last 6 hours', rangeMs: 6 * 60 * 60 * 1000, bucket: '5m' };
    case '12h':
      return { label: 'Last 12 hours', rangeMs: 12 * 60 * 60 * 1000, bucket: '10m' };
    case '1d':
      return { label: 'Last 24 hours', rangeMs: 24 * 60 * 60 * 1000, bucket: '1h' };
    case '1w':
      return { label: 'Last 7 days', rangeMs: 7 * 24 * 60 * 60 * 1000, bucket: '6h' };
  }
};

const fetchJson = async <T>(path: string): Promise<T> => {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`Request failed (${res.status}) for ${path}`);
  return (await res.json()) as T;
};

const sendJson = async <T>(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown): Promise<T> => {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let message = `Request failed (${res.status}) for ${path}`;
    try {
      const payload = await res.json();
      if (payload?.error) message = payload.error;
    } catch {
      // keep the generic request failure
    }
    throw new Error(message);
  }

  return (await res.json()) as T;
};

export const deleteDevice = async (deviceId: string): Promise<{ message: string }> =>
  sendJson<{ message: string }>(`/devices/${encodeURIComponent(deviceId)}`, 'DELETE');

// PM2.5 -> AQI (US EPA breakpoints). Enough for display-level accuracy.
const aqiFromPm25 = (pm25: number): number => {
  const bps = [
    { cLow: 0.0, cHigh: 12.0, aLow: 0, aHigh: 50 },
    { cLow: 12.1, cHigh: 35.4, aLow: 51, aHigh: 100 },
    { cLow: 35.5, cHigh: 55.4, aLow: 101, aHigh: 150 },
    { cLow: 55.5, cHigh: 150.4, aLow: 151, aHigh: 200 },
    { cLow: 150.5, cHigh: 250.4, aLow: 201, aHigh: 300 },
    { cLow: 250.5, cHigh: 350.4, aLow: 301, aHigh: 400 },
    { cLow: 350.5, cHigh: 500.4, aLow: 401, aHigh: 500 },
  ];

  const c = Math.max(0, pm25);
  const bp = bps.find((b) => c >= b.cLow && c <= b.cHigh) || bps[bps.length - 1];
  const aqi = ((bp.aHigh - bp.aLow) / (bp.cHigh - bp.cLow)) * (c - bp.cLow) + bp.aLow;
  return Math.round(aqi);
};

const emptyPoint = (timestamp: string): AirQualityData => ({
  timestamp,
  aqi: 0,
  pm25: 0,
  pm10: 0,
  co2: 0,
  voc: 0,
  temp: 0,
  humidity: 0,
});

const mergeMetricsToAirQualityData = (metrics: Record<string, BackendHistoryPoint[]>): AirQualityData[] => {
  const byTs = new Map<string, AirQualityData>();

  const ensure = (ts: string) => {
    const existing = byTs.get(ts);
    if (existing) return existing;
    const next = emptyPoint(ts);
    byTs.set(ts, next);
    return next;
  };

  for (const [metricName, points] of Object.entries(metrics)) {
    for (const p of points) {
      const row = ensure(p.timestamp);
      switch (metricName as BackendMetricName) {
        case 'co2':
          row.co2 = p.avg;
          break;
        case 'voc':
          row.voc = p.avg;
          break;
        case 'pm2_5':
          row.pm25 = p.avg;
          break;
        case 'pm10':
          row.pm10 = p.avg;
          break;
        case 'temperature':
          row.temp = p.avg;
          break;
        case 'humidity':
          row.humidity = p.avg;
          break;
      }
    }
  }

  const rows = [...byTs.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  for (const r of rows) r.aqi = aqiFromPm25(r.pm25);
  return rows;
};

export const getDeviceHistoryWindow = async (
  deviceId: string,
  window: TimeWindow,
  opts?: { forceRefresh?: boolean }
): Promise<{ label: string; data: AirQualityData[] }> => {
  const cfg = getWindowConfig(window);
  const end = new Date();
  const start = new Date(end.getTime() - cfg.rangeMs);

  const qs = new URLSearchParams({
    start: toIso(start),
    end: toIso(end),
    bucket: cfg.bucket,
  });

  const key = `${HISTORY_CACHE_PREFIX}${deviceId}:${window}:${cfg.bucket}`;

  const res = await sessionCacheFetch(
    key,
    getHistoryTtlMs(window),
    async () => fetchJson<BackendHistoryResponse>(`/devices/${encodeURIComponent(deviceId)}/history?${qs.toString()}`),
    opts
  );

  if (!('metrics' in res)) {
    // If the backend returns single-metric mode unexpectedly, still render something.
    const metrics = { [res.metric]: res.points } as Record<string, BackendHistoryPoint[]>;
    return { label: cfg.label, data: mergeMetricsToAirQualityData(metrics) };
  }

  return { label: cfg.label, data: mergeMetricsToAirQualityData(res.metrics) };
};

const mapLatestToAirQualityData = (latest: NonNullable<BackendLatestResponse['latest']>): AirQualityData => {
  const data = emptyPoint(latest.windowEnd);
  data.co2 = latest.metrics.co2?.avg ?? 0;
  data.voc = latest.metrics.voc?.avg ?? 0;
  data.pm25 = latest.metrics.pm2_5?.avg ?? 0;
  data.pm10 = latest.metrics.pm10?.avg ?? 0;
  data.temp = latest.metrics.temperature?.avg ?? 0;
  data.humidity = latest.metrics.humidity?.avg ?? 0;
  data.aqi = aqiFromPm25(data.pm25);
  return data;
};

export const getDeviceLatestSummary = async (
  deviceId: string,
  opts?: { forceRefresh?: boolean }
): Promise<AirQualityData | null> => {
  const key = `${LATEST_CACHE_PREFIX}${deviceId}`;
  const res = await sessionCacheFetch(
    key,
    60 * 1000,
    async () => fetchJson<BackendLatestResponse>(`/devices/${encodeURIComponent(deviceId)}/latest`),
    opts
  );
  if (!res.latest) return null;
  return mapLatestToAirQualityData(res.latest);
};

export const getDeviceAlerts = async (
  deviceId: string,
  opts?: { status?: 'active' | 'resolved'; forceRefresh?: boolean }
): Promise<DeviceAlert[]> => {
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);

  const key = `${ALERTS_CACHE_PREFIX}${deviceId}:${opts?.status || 'all'}`;

  const res = await sessionCacheFetch(
    key,
    ALERTS_TTL_MS,
    async () =>
      fetchJson<{ deviceId: string; alerts: DeviceAlert[] }>(
        `/devices/${encodeURIComponent(deviceId)}/alerts${qs.toString() ? `?${qs.toString()}` : ''}`
      ),
    opts
  );

  return res.alerts || [];
};

export const getAlertEmailSettings = async (deviceId: string): Promise<AlertEmailSettings> => {
  const res = await fetchJson<{ deviceId: string; settings: AlertEmailSettings }>(
    `/devices/${encodeURIComponent(deviceId)}/alert-email`
  );
  return res.settings;
};

export const updateAlertEmailSettings = async (
  deviceId: string,
  settings: { enabled?: boolean; repeatIntervalMinutes?: number }
): Promise<AlertEmailSettings> => {
  const res = await sendJson<{ deviceId: string; settings: AlertEmailSettings }>(
    `/devices/${encodeURIComponent(deviceId)}/alert-email`,
    'PUT',
    settings
  );
  return res.settings;
};

export const requestAlertEmailConfirmation = async (
  deviceId: string,
  email: string
): Promise<{ pendingRecipientEmail: string; confirmationExpiresAt: string }> =>
  sendJson<{ pendingRecipientEmail: string; confirmationExpiresAt: string }>(
    `/devices/${encodeURIComponent(deviceId)}/alert-email/request-confirmation`,
    'POST',
    { email }
  );

export const sendTestAlertEmail = async (deviceId: string): Promise<{ sentTo: string }> =>
  sendJson<{ sentTo: string }>(
    `/devices/${encodeURIComponent(deviceId)}/alert-email/test`,
    'POST'
  );
