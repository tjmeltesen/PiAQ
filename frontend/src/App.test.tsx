import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./services/airQualityService', () => ({
  deleteDevice: vi.fn(),
  getAlertEmailSettings: vi.fn(),
  getDeviceHistoryWindow: vi.fn(),
  getDeviceLatestSummary: vi.fn(),
  requestAlertEmailConfirmation: vi.fn(),
  sendTestAlertEmail: vi.fn(),
  updateAlertEmailSettings: vi.fn(),
}));

vi.mock('./components/InsightsPanel', () => ({
  InsightsPanel: () => <div>Insights Panel</div>,
}));

vi.mock('./components/AlertsBanner', () => ({
  AlertsBanner: () => <div>Alerts Banner</div>,
}));

import { deleteDevice, getAlertEmailSettings, getDeviceHistoryWindow, getDeviceLatestSummary } from './services/airQualityService';

const historyRows = [
  {
    timestamp: '2026-01-01T00:00:00.000Z',
    aqi: 50,
    pm25: 10,
    pm10: 20,
    co2: 500,
    voc: 100,
    temp: 20,
    humidity: 50,
  },
  {
    timestamp: '2026-01-01T01:00:00.000Z',
    aqi: 60,
    pm25: 20,
    pm10: 30,
    co2: 700,
    voc: 200,
    temp: 22,
    humidity: 60,
  },
];

describe('App UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ devices: [{ deviceId: 'device-1', locationLabel: 'Lab' }] }),
      })
    );

    vi.mocked(getDeviceLatestSummary).mockResolvedValue({
      timestamp: '2026-01-01T01:30:00.000Z',
      aqi: 64.2,
      pm25: 21.678,
      pm10: 33.888,
      co2: 800.555,
      voc: 220.123,
      temp: 25,
      humidity: 54.321,
    });

    vi.mocked(getDeviceHistoryWindow).mockImplementation(async (_deviceId, window) => {
      if (window === '6h') return { label: 'Last 6 hours', data: historyRows };
      if (window === '12h') return { label: 'Last 12 hours', data: historyRows };
      if (window === '1w') return { label: 'Last 7 days', data: historyRows };
      return { label: 'Last 24 hours', data: historyRows };
    });

    vi.mocked(getAlertEmailSettings).mockResolvedValue({
      enabled: false,
      recipientEmail: null,
      recipientVerifiedAt: null,
      pendingRecipientEmail: null,
      confirmationExpiresAt: null,
      repeatIntervalMinutes: 20,
      emailDeliveryConfigured: true,
    });

    vi.mocked(deleteDevice).mockResolvedValue({ message: 'Device deleted successfully' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders key dashboard UI and formats values to 2 decimals', async () => {
    render(<App />);

    expect(await screen.findByText('PiAQ')).toBeInTheDocument();
    await screen.findByText('21.68');

    expect(screen.getByText('21.68')).toBeInTheDocument();
    expect(screen.getByText('800.55')).toBeInTheDocument();
    expect(screen.getByText('54.32%')).toBeInTheDocument();

    expect(screen.getByText('15.00')).toBeInTheDocument();
    expect(screen.getByText('600.00')).toBeInTheDocument();
  });

  it('performs outbound GET to load devices and bootstraps data requests', async () => {
    render(<App />);
    await screen.findByText('Lab (device-1)');

    const firstFetchUrl = String(vi.mocked(globalThis.fetch).mock.calls[0]?.[0] ?? '');
    expect(firstFetchUrl).toMatch(/\/devices$/);
    await waitFor(() => {
      expect(vi.mocked(getDeviceHistoryWindow)).toHaveBeenCalledWith('device-1', '1d', undefined);
      expect(vi.mocked(getDeviceLatestSummary)).toHaveBeenCalledWith('device-1', undefined);
    });
  });

  it('deletes a device from the top device menu after confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    try {
      render(<App />);
      await screen.findByText('Lab (device-1)');

      fireEvent.click(screen.getByRole('button', { name: 'Select device' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete Lab (device-1)' }));

      await waitFor(() => {
        expect(vi.mocked(deleteDevice)).toHaveBeenCalledWith('device-1');
      });
      expect(screen.getByText('No registered devices')).toBeInTheDocument();
      expect(confirmSpy).toHaveBeenCalled();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('applies settings changes and persists to localStorage', async () => {
    render(<App />);
    await screen.findByText('21.68');

    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    fireEvent.change(screen.getByLabelText('Temperature Units'), { target: { value: 'F' } });
    fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'UTC' } });
    fireEvent.change(screen.getByLabelText('Auto Refresh Interval'), { target: { value: '1' } });

    await waitFor(() => {
      expect(screen.getByText('77.00°F')).toBeInTheDocument();
    });

    const saved = JSON.parse(localStorage.getItem('piaq:userSettings:v1') || '{}');
    expect(saved.temperatureUnit).toBe('F');
    expect(saved.timezone).toBe('UTC');
    expect(saved.refreshIntervalMinutes).toBe(1);
  });

  it('triggers auto refresh on interval', async () => {
    vi.useFakeTimers();
    render(<App />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(vi.mocked(getDeviceHistoryWindow)).toHaveBeenCalled();

    vi.mocked(getDeviceHistoryWindow).mockClear();
    vi.mocked(getDeviceLatestSummary).mockClear();

    await act(async () => {
      vi.advanceTimersByTime(5 * 60 * 1000);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(vi.mocked(getDeviceHistoryWindow)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(getDeviceHistoryWindow)).toHaveBeenCalledWith('device-1', '1d', undefined);

    await act(async () => {
      vi.advanceTimersByTime(60 * 1000);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(vi.mocked(getDeviceLatestSummary)).toHaveBeenCalledWith('device-1', undefined);
  });

  it('triggers force-refresh GET requests from the refresh button', async () => {
    render(<App />);
    await screen.findByText('21.68');
    vi.mocked(getDeviceHistoryWindow).mockClear();
    vi.mocked(getDeviceLatestSummary).mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh sensor data' }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const historyForceCalls = vi
      .mocked(getDeviceHistoryWindow)
      .mock.calls.filter(([, , opts]) => opts?.forceRefresh === true);
    expect(historyForceCalls).toHaveLength(2);
    expect(vi.mocked(getDeviceLatestSummary)).toHaveBeenCalledWith('device-1', { forceRefresh: true });
  });

  it('requests new window data when user changes the time window', async () => {
    render(<App />);
    await screen.findByText('21.68');
    vi.mocked(getDeviceHistoryWindow).mockClear();

    fireEvent.click(screen.getAllByRole('button', { name: '6h' })[0]);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const sixHourCalls = vi
      .mocked(getDeviceHistoryWindow)
      .mock.calls.filter(([, window]) => window === '6h');
    expect(sixHourCalls.length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Last 6 hours').length).toBeGreaterThan(0);
  });
});
