import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionCacheClearAll } from './sessionCache';

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.stubGlobal('fetch', fetchMock);

import { getAirQualityInsights } from './geminiService';

const sampleData = {
  timestamp: '2026-02-01T00:00:00.000Z',
  aqi: 72,
  pm25: 18,
  pm10: 25,
  co2: 650,
  voc: 110,
  temp: 23,
  humidity: 45,
};

describe('openai insights service outbound POST-style calls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    sessionCacheClearAll();
  });

  it('calls OpenAI with expected payload and parses JSON insights', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                insights: [
                  { id: 'i1', type: 'health', message: 'Open windows for ventilation.', severity: 'medium' },
                ],
              }),
            },
          },
        ],
      }),
    });

    const insights = await getAirQualityInsights(sampleData, { forceRefresh: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(request.method).toBe('POST');
    expect(request.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: expect.stringContaining('Bearer '),
    });

    const body = JSON.parse(request.body as string) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      response_format: { type: string };
    };
    expect(body.model).toBe('gpt-4.1-nano');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[1].content).toContain('AQI: 72');
    expect(body.messages[1].content).toContain('PM2.5: 18');
    expect(insights).toEqual([
      { id: 'i1', type: 'health', message: 'Open windows for ventilation.', severity: 'medium' },
    ]);
  });

  it('returns empty list when provider returns no text body', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValueOnce({ choices: [{ message: { content: '' } }] }),
    });

    const insights = await getAirQualityInsights(
      { ...sampleData, timestamp: '2026-02-01T00:06:00.000Z' },
      { forceRefresh: true }
    );

    expect(insights).toEqual([]);
  });

  it('reuses cached result for same 5-minute bucket unless forceRefresh is set', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                insights: [{ id: 'c1', type: 'action', message: 'Keep filters clean.', severity: 'low' }],
              }),
            },
          },
        ],
      }),
    });

    const first = await getAirQualityInsights(
      { ...sampleData, timestamp: '2026-02-01T00:10:01.000Z' },
      { forceRefresh: false }
    );
    const second = await getAirQualityInsights(
      { ...sampleData, timestamp: '2026-02-01T00:10:59.000Z' },
      { forceRefresh: false }
    );
    await getAirQualityInsights(
      { ...sampleData, timestamp: '2026-02-01T00:10:59.000Z' },
      { forceRefresh: true }
    );

    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns fallback insight when OpenAI request fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network failed'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const insights = await getAirQualityInsights(
      { ...sampleData, timestamp: '2026-02-01T00:20:00.000Z' },
      { forceRefresh: true }
    );

    expect(insights).toEqual([
      {
        id: 'error',
        type: 'alert',
        message: 'Unable to generate AI insights at this time. Please check your connection.',
        severity: 'low',
      },
    ]);

    errorSpy.mockRestore();
  });

  it('returns fallback insight when provider returns invalid JSON', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValueOnce({
        choices: [{ message: { content: '{invalid-json' } }],
      }),
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const insights = await getAirQualityInsights(
      { ...sampleData, timestamp: '2026-02-01T00:25:00.000Z' },
      { forceRefresh: true }
    );

    expect(insights[0]).toMatchObject({
      id: 'error',
      type: 'alert',
    });
    errorSpy.mockRestore();
  });

  it('calls provider again for a different 5-minute time bucket', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                insights: [{ id: 't1', type: 'health', message: 'Track trends', severity: 'low' }],
              }),
            },
          },
        ],
      }),
    });

    await getAirQualityInsights(
      { ...sampleData, timestamp: '2026-02-01T00:00:30.000Z' },
      { forceRefresh: false }
    );
    await getAirQualityInsights(
      { ...sampleData, timestamp: '2026-02-01T00:06:00.000Z' },
      { forceRefresh: false }
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
