import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDevice, getDeviceAlerts, getDeviceHistoryWindow, getDeviceLatestSummary, type TimeWindow } from './airQualityService';
import { sessionCacheClearAll } from './sessionCache';

const mkFetchResponse = (body: unknown, ok = true, status = 200) =>
  Promise.resolve({
    ok,
    status,
    json: async () => body,
  } as Response);

describe('airQualityService outbound GETs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    sessionCacheClearAll();
  });

  it.each([
    ['6h', '5m', 'Last 6 hours'],
    ['12h', '10m', 'Last 12 hours'],
    ['1d', '1h', 'Last 24 hours'],
    ['1w', '6h', 'Last 7 days'],
  ] as Array<[TimeWindow, string, string]>)(
    'requests history for %s window with expected bucket and label',
    async (window, bucket, label) => {
      const fetchMock = vi.fn().mockImplementation(() =>
        mkFetchResponse({
          deviceId: 'dev-1',
          range: { start: '2026-01-01T00:00:00.000Z', end: '2026-01-01T06:00:00.000Z', bucket },
          metrics: {
            pm2_5: [{ timestamp: '2026-01-01T00:00:00.000Z', avg: 12.1, min: 10, max: 15 }],
            co2: [{ timestamp: '2026-01-01T00:00:00.000Z', avg: 500, min: 480, max: 520 }],
          },
        })
      );
      vi.stubGlobal('fetch', fetchMock);

      const res = await getDeviceHistoryWindow('dev/1', window, { forceRefresh: true });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const calledUrl = new URL(fetchMock.mock.calls[0][0] as string, 'http://localhost');
      expect(calledUrl.pathname).toBe('/devices/dev%2F1/history');
      expect(calledUrl.searchParams.get('bucket')).toBe(bucket);
      expect(calledUrl.searchParams.get('start')).toBeTruthy();
      expect(calledUrl.searchParams.get('end')).toBeTruthy();
      expect(res.label).toBe(label);
      expect(res.data[0]).toMatchObject({
        timestamp: '2026-01-01T00:00:00.000Z',
        pm25: 12.1,
        co2: 500,
        aqi: 51,
      });
    }
  );

  it('supports single-metric history response mode', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      mkFetchResponse({
        deviceId: 'dev-2',
        range: { start: '2026-01-01T00:00:00.000Z', end: '2026-01-01T01:00:00.000Z', bucket: '5m' },
        metric: 'co2',
        points: [{ timestamp: '2026-01-01T00:10:00.000Z', avg: 650, min: 640, max: 680 }],
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await getDeviceHistoryWindow('dev-2', '6h', { forceRefresh: true });

    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toMatchObject({
      timestamp: '2026-01-01T00:10:00.000Z',
      co2: 650,
      pm25: 0,
      aqi: 0,
    });
  });

  it('requests latest summary endpoint and maps payload', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      mkFetchResponse({
        deviceId: 'device-a',
        latest: {
          windowStart: '2026-01-01T00:00:00.000Z',
          windowEnd: '2026-01-01T00:01:00.000Z',
          sampleCount: 4,
          metrics: {
            co2: { avg: 700, max: 800 },
            voc: { avg: 120, max: 140 },
            pm2_5: { avg: 30, max: 40 },
            pm10: { avg: 55, max: 65 },
            temperature: { avg: 24, max: 25 },
            humidity: { avg: 44, max: 45 },
          },
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const data = await getDeviceLatestSummary('device-a', { forceRefresh: true });

    const latestUrl = String(fetchMock.mock.calls[0]?.[0] ?? '');
    expect(latestUrl).toMatch(/\/devices\/device-a\/latest$/);
    expect(data).toMatchObject({
      timestamp: '2026-01-01T00:01:00.000Z',
      pm25: 30,
      pm10: 55,
      co2: 700,
      voc: 120,
      temp: 24,
      humidity: 44,
      aqi: 89,
    });
  });

  it('returns null when latest summary has no latest reading', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => mkFetchResponse({ deviceId: 'device-null', latest: null }))
    );

    const data = await getDeviceLatestSummary('device-null', { forceRefresh: true });
    expect(data).toBeNull();
  });

  it('sends DELETE when removing a device', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      mkFetchResponse({ message: 'Device deleted successfully' })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(deleteDevice('dev/delete')).resolves.toEqual({ message: 'Device deleted successfully' });

    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string, 'http://localhost');
    expect(calledUrl.pathname).toBe('/devices/dev%2Fdelete');
    expect(fetchMock.mock.calls[0][1]).toEqual({
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
      },
      body: undefined,
    });
  });

  it('requests alerts with status filter query params', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      mkFetchResponse({
        deviceId: 'dev alerts',
        alerts: [{ id: 'a1', message: 'High CO2' }],
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const alerts = await getDeviceAlerts('dev alerts', { status: 'active', forceRefresh: true });

    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string, 'http://localhost');
    expect(calledUrl.pathname).toBe('/devices/dev%20alerts/alerts');
    expect(calledUrl.searchParams.get('status')).toBe('active');
    expect(alerts).toEqual([{ id: 'a1', message: 'High CO2' }]);
  });

  it('throws with request path details on non-ok responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => mkFetchResponse({}, false, 503)));

    await expect(getDeviceLatestSummary('device-fail', { forceRefresh: true })).rejects.toThrow(
      'Request failed (503) for /devices/device-fail/latest'
    );
  });

  it('uses cached history response for repeated non-force calls', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      mkFetchResponse({
        deviceId: 'cache-dev',
        range: { start: '2026-01-01T00:00:00.000Z', end: '2026-01-01T06:00:00.000Z', bucket: '5m' },
        metrics: {
          pm2_5: [{ timestamp: '2026-01-01T00:00:00.000Z', avg: 10, min: 8, max: 12 }],
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await getDeviceHistoryWindow('cache-dev', '6h');
    await getDeviceHistoryWindow('cache-dev', '6h');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('bypasses cache for history when forceRefresh is true', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      mkFetchResponse({
        deviceId: 'cache-dev',
        range: { start: '2026-01-01T00:00:00.000Z', end: '2026-01-01T06:00:00.000Z', bucket: '5m' },
        metrics: {
          pm2_5: [{ timestamp: '2026-01-01T00:00:00.000Z', avg: 10, min: 8, max: 12 }],
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await getDeviceHistoryWindow('cache-dev-force', '6h');
    await getDeviceHistoryWindow('cache-dev-force', '6h', { forceRefresh: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('omits alerts status query when no status filter is provided', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      mkFetchResponse({
        deviceId: 'dev-raw',
        alerts: [],
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await getDeviceAlerts('dev-raw', { forceRefresh: true });

    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string, 'http://localhost');
    expect(calledUrl.pathname).toMatch(/\/devices\/dev-raw\/alerts$/);
    expect(calledUrl.searchParams.get('status')).toBeNull();
  });

  it('returns empty alert list when backend payload omits alerts array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => mkFetchResponse({ deviceId: 'dev-empty' })));

    const alerts = await getDeviceAlerts('dev-empty', { forceRefresh: true });
    expect(alerts).toEqual([]);
  });
});
