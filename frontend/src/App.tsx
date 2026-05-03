import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Wind, 
  Activity, 
  Thermometer, 
  Droplets, 
  AlertTriangle, 
  Info, 
  RefreshCcw,
  LayoutDashboard,
  History,
  Settings,
  Bell,
  Mail,
  Send,
  X,
  ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AirQualityData, AlertEmailSettings } from './types';
import { POLLUTANTS } from './constants';
import {
  deleteDevice,
  getAlertEmailSettings,
  getDeviceHistoryWindow,
  getDeviceLatestSummary,
  requestAlertEmailConfirmation,
  sendTestAlertEmail,
  TimeWindow,
  updateAlertEmailSettings
} from './services/airQualityService';

// Helper to fetch device list
async function fetchDevices() {
  const res = await fetch((import.meta as any).env?.VITE_API_URL + '/devices');
  if (!res.ok) throw new Error('Failed to fetch devices');
  const data = await res.json();
  return data.devices || [];
}
import { AirQualityCard } from './components/AirQualityCard';
import { AqiGauge } from './components/AqiGauge';
import { HistoricalChart } from './components/HistoricalChart';
import { InsightsPanel } from './components/InsightsPanel';
import { AlertsBanner } from './components/AlertsBanner';
import { cn, formatNumber, formatTimestamp } from './lib/utils';

type UserSettings = {
  temperatureUnit: 'C' | 'F';
  refreshIntervalMinutes: number;
  timezone: 'local' | 'UTC';
};

type DeviceOption = {
  deviceId: string;
  locationLabel?: string | null;
};

const SETTINGS_KEY = 'piaq:userSettings:v1';

const DEFAULT_SETTINGS: UserSettings = {
  temperatureUnit: 'C',
  refreshIntervalMinutes: 5,
  timezone: 'local'
};

const loadSettings = (): UserSettings => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    return {
      temperatureUnit: parsed.temperatureUnit === 'F' ? 'F' : 'C',
      refreshIntervalMinutes: typeof parsed.refreshIntervalMinutes === 'number' && parsed.refreshIntervalMinutes > 0
        ? parsed.refreshIntervalMinutes
        : DEFAULT_SETTINGS.refreshIntervalMinutes,
      timezone: parsed.timezone === 'UTC' ? 'UTC' : 'local'
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

export default function App() {
  const [deviceId, setDeviceId] = useState<string>('');
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [data, setData] = useState<AirQualityData[]>([]);
  const [latestData, setLatestData] = useState<AirQualityData | null>(null);
  const [averages, setAverages] = useState<Record<string, number | null> | null>(null);
  const [averagesLabel, setAveragesLabel] = useState('Last 12 hours');
  const [selectedPollutant, setSelectedPollutant] = useState<keyof AirQualityData>('pm25');
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('1d');
  const [timeWindowLabel, setTimeWindowLabel] = useState('Last 24 hours');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'history' | 'alerts'>('dashboard');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settings, setSettings] = useState<UserSettings>(() => loadSettings());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [alertEmailSettings, setAlertEmailSettings] = useState<AlertEmailSettings | null>(null);
  const [alertEmailInput, setAlertEmailInput] = useState('');
  const [alertEmailStatus, setAlertEmailStatus] = useState<string | null>(null);
  const [isAlertEmailBusy, setIsAlertEmailBusy] = useState(false);
  const [isDeviceMenuOpen, setIsDeviceMenuOpen] = useState(false);
  const [deletingDeviceId, setDeletingDeviceId] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const deviceMenuRef = useRef<HTMLDivElement | null>(null);
  const placeholderRef = useRef<AirQualityData>({
    timestamp: new Date().toISOString(),
    aqi: 0,
    pm25: 0,
    pm10: 0,
    co2: 0,
    voc: 0,
    temp: 0,
    humidity: 0,
  });

  const currentData = useMemo(() => latestData ?? data[data.length - 1], [latestData, data]);
  const selectedDevice = useMemo(
    () => devices.find((device) => device.deviceId === deviceId) || null,
    [devices, deviceId]
  );
  const formatDeviceLabel = (device: DeviceOption) =>
    device.locationLabel ? `${device.locationLabel} (${device.deviceId})` : device.deviceId;
  const chartData = useMemo(() => {
    if (!latestData) return data;
    if (data.length === 0) return [latestData];

    const latestMs = Date.parse(latestData.timestamp);
    if (Number.isNaN(latestMs)) return data;

    const byTimestamp = new Map<string, AirQualityData>();
    for (const row of data) byTimestamp.set(row.timestamp, row);
    byTimestamp.set(latestData.timestamp, latestData);

    return [...byTimestamp.values()].sort(
      (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)
    );
  }, [data, latestData]);
  const hasData = !!currentData;
  const displayCurrentData = currentData || placeholderRef.current;

  const temperatureUnitLabel = settings.temperatureUnit === 'F' ? '°F' : '°C';
  const toDisplayTemp = (celsiusValue: number) =>
    settings.temperatureUnit === 'F' ? (celsiusValue * 9) / 5 + 32 : celsiusValue;

  const computeAverages = (rows: AirQualityData[]) => {
    const keys: Array<keyof AirQualityData> = ['pm25', 'pm10', 'co2', 'voc', 'temp', 'humidity'];
    const totals: Record<string, { sum: number; count: number }> = {};
    for (const key of keys) totals[key] = { sum: 0, count: 0 };

    for (const row of rows) {
      for (const key of keys) {
        const value = row[key];
        if (typeof value === 'number' && !Number.isNaN(value)) {
          totals[key].sum += value;
          totals[key].count += 1;
        }
      }
    }

    const averagesResult: Record<string, number | null> = {};
    for (const key of keys) {
      const { sum, count } = totals[key];
      averagesResult[key] = count ? sum / count : null;
    }
    return averagesResult;
  };

  const refreshData = async (opts?: { forceRefresh?: boolean }) => {
    setIsRefreshing(true);
    try {
      const res = await getDeviceHistoryWindow(deviceId, timeWindow, opts);
      if (mountedRef.current) {
        setLoadError(null);
        setTimeWindowLabel(res.label);
        setData(res.data);
      }
    } catch (err: any) {
      console.error('Failed to refresh air quality data:', err);
      if (mountedRef.current) {
        setLoadError(err?.message || 'Failed to reach backend');
      }
    } finally {
      if (mountedRef.current) setIsRefreshing(false);
    }
  };

  const refreshLatest = async (opts?: { forceRefresh?: boolean }) => {
    try {
      const latest = await getDeviceLatestSummary(deviceId, opts);
      if (!mountedRef.current) return;
      if (latest) {
        setLatestData(latest);
      }
    } catch (err) {
      console.warn('Failed to refresh latest data:', err);
    }
  };

  const refreshAverages = async (opts?: { forceRefresh?: boolean }) => {
    try {
      const res = await getDeviceHistoryWindow(deviceId, timeWindow, opts);
      if (!mountedRef.current) return;
      setAveragesLabel(res.label);
      setAverages(computeAverages(res.data));
    } catch (err) {
      console.warn('Failed to refresh averages:', err);
      if (mountedRef.current) setAverages(null);
    }
  };

  const refreshAlertEmailSettings = async () => {
    if (!deviceId) return;
    try {
      const next = await getAlertEmailSettings(deviceId);
      if (!mountedRef.current) return;
      setAlertEmailSettings(next);
      setAlertEmailInput(next.pendingRecipientEmail || next.recipientEmail || '');
    } catch (err: any) {
      console.warn('Failed to load alert email settings:', err);
      if (mountedRef.current) setAlertEmailStatus(err?.message || 'Failed to load alert email settings');
    }
  };

  const saveAlertEmailSettings = async (next: { enabled?: boolean; repeatIntervalMinutes?: number }) => {
    if (!deviceId) return;
    setIsAlertEmailBusy(true);
    setAlertEmailStatus(null);
    try {
      const saved = await updateAlertEmailSettings(deviceId, next);
      if (!mountedRef.current) return;
      setAlertEmailSettings(saved);
      setAlertEmailStatus('Alert email settings saved.');
    } catch (err: any) {
      if (mountedRef.current) setAlertEmailStatus(err?.message || 'Failed to save alert email settings');
    } finally {
      if (mountedRef.current) setIsAlertEmailBusy(false);
    }
  };

  const sendAlertEmailConfirmation = async () => {
    if (!deviceId) return;
    setIsAlertEmailBusy(true);
    setAlertEmailStatus(null);
    try {
      await requestAlertEmailConfirmation(deviceId, alertEmailInput);
      await refreshAlertEmailSettings();
      if (mountedRef.current) setAlertEmailStatus('Confirmation email sent. Check that inbox to finish setup.');
    } catch (err: any) {
      if (mountedRef.current) setAlertEmailStatus(err?.message || 'Failed to send confirmation email');
    } finally {
      if (mountedRef.current) setIsAlertEmailBusy(false);
    }
  };

  const sendAlertEmailTest = async () => {
    if (!deviceId) return;
    setIsAlertEmailBusy(true);
    setAlertEmailStatus(null);
    try {
      await sendTestAlertEmail(deviceId);
      if (mountedRef.current) setAlertEmailStatus('Test alert email sent.');
    } catch (err: any) {
      if (mountedRef.current) setAlertEmailStatus(err?.message || 'Failed to send test alert email');
    } finally {
      if (mountedRef.current) setIsAlertEmailBusy(false);
    }
  };

  const handleDeleteDevice = async (deviceToDelete: DeviceOption) => {
    const label = formatDeviceLabel(deviceToDelete);
    const confirmed = window.confirm(
      `Delete ${label}? This removes the device and its stored readings from the database. The physical device will need to register again before it appears here.`
    );

    if (!confirmed) return;

    setDeletingDeviceId(deviceToDelete.deviceId);
    setLoadError(null);

    try {
      await deleteDevice(deviceToDelete.deviceId);
      if (!mountedRef.current) return;

      setDevices((prev) => {
        const nextDevices = prev.filter((device) => device.deviceId !== deviceToDelete.deviceId);

        if (deviceId === deviceToDelete.deviceId) {
          const nextSelectedDevice = nextDevices[0]?.deviceId || '';
          setDeviceId(nextSelectedDevice);

          if (!nextSelectedDevice) {
            setData([]);
            setLatestData(null);
            setAverages(null);
            setAlertEmailSettings(null);
            setAlertEmailStatus(null);
          }
        }

        return nextDevices;
      });
      setIsDeviceMenuOpen(false);
    } catch (err: any) {
      if (mountedRef.current) setLoadError(err?.message || 'Failed to delete device');
    } finally {
      if (mountedRef.current) setDeletingDeviceId(null);
    }
  };

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // ignore
    }
  }, [settings]);

  useEffect(() => {
    if (!isDeviceMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!deviceMenuRef.current?.contains(event.target as Node)) {
        setIsDeviceMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isDeviceMenuOpen]);


  // Fetch device list on mount
  useEffect(() => {
    let ignore = false;
    mountedRef.current = true;
    fetchDevices()
      .then((list) => {
        if (!ignore) {
          setDevices(list);
          // Set default deviceId to first device if not set
          if (list.length && !deviceId) setDeviceId(list[0].deviceId);
        }
      })
      .catch(() => {});
    return () => {
      mountedRef.current = false;
      ignore = true;
    };
  }, []);

  // Refresh data when deviceId changes
  useEffect(() => {
    if (deviceId) {
      setLatestData(null);
      setAverages(null);
      setAlertEmailSettings(null);
      setAlertEmailStatus(null);
      refreshData();
      refreshLatest();
      refreshAverages();
      refreshAlertEmailSettings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  useEffect(() => {
    if (!mountedRef.current || !deviceId) return;
    refreshData();
    refreshAverages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeWindow]);

  useEffect(() => {
    if (!deviceId) return;
    const id = window.setInterval(() => {
      refreshLatest();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [deviceId]);

  useEffect(() => {
    if (!deviceId) return;
    const intervalMs = Math.max(1, settings.refreshIntervalMinutes) * 60 * 1000;
    const id = window.setInterval(() => {
      refreshData();
      refreshAverages();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [deviceId, timeWindow, settings.refreshIntervalMinutes]);

  return (
    <div className="min-h-screen bg-black text-zinc-300 font-sans selection:bg-indigo-500/30">
      {/* Device Selector Dropdown */}
      <div className="w-full flex justify-center py-4 bg-zinc-950/80 border-b border-zinc-800/50">
        <label className="mr-2 text-sm text-zinc-400">Device:</label>
        <div ref={deviceMenuRef} className="relative w-72 max-w-[70vw]">
          <button
            type="button"
            aria-label="Select device"
            aria-expanded={isDeviceMenuOpen}
            onClick={() => setIsDeviceMenuOpen((open) => !open)}
            disabled={!devices.length}
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1 text-left text-zinc-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="min-w-0 truncate text-sm">
              {selectedDevice ? formatDeviceLabel(selectedDevice) : 'No registered devices'}
            </span>
            <ChevronDown className="h-4 w-4 flex-shrink-0 text-zinc-500" />
          </button>

          {isDeviceMenuOpen && (
            <div className="absolute left-0 right-0 top-[calc(100%+0.4rem)] z-[70] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950 shadow-2xl shadow-black/40">
              {devices.map((device) => {
                const isSelected = device.deviceId === deviceId;
                const isDeleting = deletingDeviceId === device.deviceId;

                return (
                  <div
                    key={device.deviceId}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1",
                      isSelected ? "bg-indigo-600/20" : "hover:bg-zinc-900"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setDeviceId(device.deviceId);
                        setIsDeviceMenuOpen(false);
                      }}
                      className="min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm text-zinc-200"
                    >
                      {formatDeviceLabel(device)}
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${formatDeviceLabel(device)}`}
                      title={`Delete ${formatDeviceLabel(device)}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleDeleteDevice(device);
                      }}
                      disabled={!!deletingDeviceId}
                      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-rose-500/10 hover:text-rose-300 disabled:cursor-wait disabled:opacity-50"
                    >
                      <X className={cn("h-4 w-4", isDeleting && "animate-pulse")} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {/* Sidebar Navigation */}
      <aside className="fixed left-0 top-0 bottom-0 w-20 border-r border-zinc-800/50 bg-zinc-950/50 backdrop-blur-xl z-50 flex flex-col items-center py-8 gap-8">
        <div className="w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-[0_0_20px_rgba(79,70,229,0.4)]">
          <Wind className="w-6 h-6 text-white" />
        </div>
        
        <nav className="flex flex-col gap-4">
          <button 
            onClick={() => setActiveTab('dashboard')}
            aria-label="Open dashboard tab"
            className={cn(
              "p-3 rounded-xl transition-all duration-300 group relative",
              activeTab === 'dashboard' ? "bg-white/10 text-white" : "text-zinc-600 hover:text-zinc-400"
            )}
          >
            <LayoutDashboard className="w-5 h-5" />
            {activeTab === 'dashboard' && <motion.div layoutId="nav-glow" className="absolute inset-0 bg-indigo-500/10 blur-md rounded-xl" />}
          </button>
          <button 
            onClick={() => setActiveTab('history')}
            aria-label="Open history tab"
            className={cn(
              "p-3 rounded-xl transition-all duration-300 group relative",
              activeTab === 'history' ? "bg-white/10 text-white" : "text-zinc-600 hover:text-zinc-400"
            )}
          >
            <History className="w-5 h-5" />
            {activeTab === 'history' && <motion.div layoutId="nav-glow" className="absolute inset-0 bg-indigo-500/10 blur-md rounded-xl" />}
          </button>
          <button 
            onClick={() => setActiveTab('alerts')}
            aria-label="Open alerts tab"
            className={cn(
              "p-3 rounded-xl transition-all duration-300 group relative",
              activeTab === 'alerts' ? "bg-white/10 text-white" : "text-zinc-600 hover:text-zinc-400"
            )}
          >
            <Bell className="w-5 h-5" />
            {activeTab === 'alerts' && <motion.div layoutId="nav-glow" className="absolute inset-0 bg-indigo-500/10 blur-md rounded-xl" />}
          </button>
        </nav>

        <div className="mt-auto flex flex-col gap-4">
          <button
            onClick={() => setIsSettingsOpen(true)}
            aria-label="Open settings"
            className="p-3 rounded-xl text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="pl-20 min-h-screen pb-20">
        {/* Header */}
        <header className="sticky top-0 z-40 border-b border-zinc-800/50 bg-black/50 backdrop-blur-md px-8 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              PiAQ <span className="text-[10px] uppercase tracking-[0.3em] font-black text-indigo-500 bg-indigo-500/10 px-2 py-0.5 rounded-full">Monitor</span>
            </h1>
            <p className="text-xs text-zinc-500 mt-0.5">Real-time Environmental Intelligence</p>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-6 px-4 py-2 bg-zinc-900/50 rounded-2xl border border-zinc-800/50">
              <div className="flex items-center gap-2">
                <Thermometer className="w-4 h-4 text-orange-400" />
                <span className="text-sm font-medium text-white">
                  {hasData ? `${formatNumber(toDisplayTemp(displayCurrentData.temp))}${temperatureUnitLabel}` : '--'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Droplets className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-medium text-white">
                  {hasData ? `${formatNumber(displayCurrentData.humidity)}%` : '--'}
                </span>
              </div>
            </div>

            <button 
              onClick={() => {
                refreshData({ forceRefresh: true });
                refreshLatest({ forceRefresh: true });
                refreshAverages({ forceRefresh: true });
              }}
              aria-label="Refresh sensor data"
              disabled={isRefreshing}
              className="p-2.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-xl transition-all disabled:opacity-50"
            >
              <RefreshCcw className={cn("w-4 h-4 text-zinc-400", isRefreshing && "animate-spin")} />
            </button>
          </div>
        </header>

        {(loadError || !hasData) && (
          <div className="px-8 pt-4">
            <div className={cn(
              "rounded-2xl border px-4 py-3 backdrop-blur-md",
              loadError ? "border-rose-500/30 bg-rose-500/10" : "border-amber-500/20 bg-amber-500/10"
            )}>
              <div className={cn(
                "text-[10px] uppercase tracking-widest",
                loadError ? "text-rose-200/80" : "text-amber-200/80"
              )}>
                {loadError ? (hasData ? 'Offline • showing cached data' : 'Offline • no data loaded yet') : 'Loading sensor data…'}
              </div>
              {loadError && (
                <div className="mt-1 text-sm text-zinc-200/90">
                  {loadError}
                  <button
                    onClick={() => refreshData({ forceRefresh: true })}
                    className="ml-3 rounded-xl border border-zinc-800/60 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-widest text-zinc-200 hover:bg-white/10"
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <AlertsBanner deviceId={deviceId} />

        {/* Dashboard Content */}
        <div className="p-8 max-w-[1600px] mx-auto">
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="grid grid-cols-1 lg:grid-cols-12 gap-8"
              >
                {/* Left Column: Gauge & Insights */}
                <div className="lg:col-span-4 space-y-8">
                  <AqiGauge aqi={displayCurrentData.aqi} />
                  {hasData ? (
                    <InsightsPanel currentData={displayCurrentData} />
                  ) : (
                    <div className="p-6 bg-zinc-900/40 rounded-3xl border border-zinc-800/50 backdrop-blur-sm h-[500px] flex flex-col justify-center items-center text-center">
                      <div className="text-xs uppercase tracking-widest text-zinc-500">No data yet</div>
                      <div className="mt-2 text-sm text-zinc-400">Start the backend (and device ingest) to see live insights.</div>
                      <button
                        onClick={() => refreshData({ forceRefresh: true })}
                        className="mt-4 rounded-2xl border border-zinc-800 bg-white/5 px-4 py-2 text-xs uppercase tracking-widest text-zinc-200 hover:bg-white/10"
                      >
                        Retry
                      </button>
                    </div>
                  )}
                </div>

                {/* Right Column: Pollutants & Chart */}
                <div className="lg:col-span-8 space-y-8">
                  {/* Pollutant Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {Object.entries(POLLUTANTS).map(([key, pollutant]) => (
                      <AirQualityCard 
                        key={key} 
                        pollutant={pollutant} 
                        value={displayCurrentData[key as keyof AirQualityData] as number} 
                      />
                    ))}
                  </div>

                  {/* Trends Section */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between px-2 gap-4 flex-wrap">
                      <div className="flex items-center gap-2">
                        <Activity className="w-4 h-4 text-indigo-400" />
                        <h2 className="text-sm font-medium uppercase tracking-widest text-zinc-400">Historical Trends</h2>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="flex bg-zinc-900/50 p-1 rounded-xl border border-zinc-800/50">
                          {(['6h', '12h', '1d', '1w'] as TimeWindow[]).map((w) => (
                            <button
                              key={w}
                              onClick={() => setTimeWindow(w)}
                              className={cn(
                                "px-3 py-1 rounded-lg text-[10px] uppercase tracking-widest font-bold transition-all",
                                timeWindow === w ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-300"
                              )}
                            >
                              {w}
                            </button>
                          ))}
                        </div>

                        <div className="flex bg-zinc-900/50 p-1 rounded-xl border border-zinc-800/50">
                          {['pm25', 'co2', 'voc'].map((p) => (
                            <button
                              key={p}
                              onClick={() => setSelectedPollutant(p as keyof AirQualityData)}
                              className={cn(
                                "px-3 py-1 rounded-lg text-[10px] uppercase tracking-widest font-bold transition-all",
                                selectedPollutant === p ? "bg-indigo-600 text-white shadow-lg" : "text-zinc-500 hover:text-zinc-300"
                              )}
                            >
                              {POLLUTANTS[p]?.name || p}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <HistoricalChart
                      data={chartData}
                      dataKey={selectedPollutant}
                      color="#6366f1"
                      label={POLLUTANTS[selectedPollutant as string]?.name || (selectedPollutant as string)}
                      windowLabel={timeWindowLabel}
                      unit={POLLUTANTS[selectedPollutant as string]?.unit}
                      timezone={settings.timezone}
                    />
                  </div>
                </div>

                <div className="lg:col-span-12">
                  <div className="rounded-3xl border border-zinc-800/50 bg-zinc-900/30 p-6 backdrop-blur-sm">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-2">
                        <History className="w-4 h-4 text-indigo-400" />
                        <h3 className="text-sm font-medium uppercase tracking-widest text-zinc-400">
                          Averages
                        </h3>
                      </div>
                      <span className="text-[10px] uppercase tracking-widest text-zinc-500">
                        {averagesLabel}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
                      {[
                        { key: 'pm25', label: 'PM2.5', unit: 'µg/m³', value: averages?.pm25 ?? null },
                        { key: 'pm10', label: 'PM10', unit: 'µg/m³', value: averages?.pm10 ?? null },
                        { key: 'co2', label: 'CO2', unit: 'ppm', value: averages?.co2 ?? null },
                        { key: 'voc', label: 'VOC', unit: 'ppb', value: averages?.voc ?? null },
                        {
                          key: 'temp',
                          label: 'Temperature',
                          unit: temperatureUnitLabel,
                          value: averages?.temp != null ? toDisplayTemp(averages.temp) : null
                        },
                        { key: 'humidity', label: 'Humidity', unit: '%', value: averages?.humidity ?? null }
                      ].map((item) => (
                        <div
                          key={item.key}
                          className="rounded-2xl border border-zinc-800/60 bg-black/20 px-4 py-3"
                        >
                          <div className="text-[10px] uppercase tracking-widest text-zinc-500">{item.label}</div>
                          <div className="mt-2 flex items-baseline gap-1">
                            <span className="text-lg font-semibold text-white">
                              {formatNumber(item.value)}
                            </span>
                            <span className="text-[10px] text-zinc-500">{item.unit}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'history' && (
              <motion.div
                key="history"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                <div className="flex items-center justify-between gap-4 mb-8 flex-wrap">
                  <div className="flex items-center gap-2">
                    <History className="w-6 h-6 text-indigo-400" />
                    <h2 className="text-2xl font-bold text-white tracking-tight">Data History</h2>
                  </div>

                  <div className="flex bg-zinc-900/50 p-1 rounded-xl border border-zinc-800/50">
                    {(['6h', '12h', '1d', '1w'] as TimeWindow[]).map((w) => (
                      <button
                        key={w}
                        onClick={() => setTimeWindow(w)}
                        className={cn(
                          "px-3 py-1 rounded-lg text-[10px] uppercase tracking-widest font-bold transition-all",
                          timeWindow === w ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-300"
                        )}
                      >
                        {w}
                      </button>
                    ))}
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <HistoricalChart data={chartData} dataKey="aqi" color="#10b981" label="AQI" windowLabel={timeWindowLabel} unit="AQI" timezone={settings.timezone} />
                  <HistoricalChart data={chartData} dataKey="pm25" color="#6366f1" label="PM2.5" windowLabel={timeWindowLabel} unit={POLLUTANTS.pm25.unit} timezone={settings.timezone} />
                  <HistoricalChart data={chartData} dataKey="co2" color="#f59e0b" label="CO2" windowLabel={timeWindowLabel} unit={POLLUTANTS.co2.unit} timezone={settings.timezone} />
                  <HistoricalChart data={chartData} dataKey="voc" color="#8b5cf6" label="VOC" windowLabel={timeWindowLabel} unit={POLLUTANTS.voc.unit} timezone={settings.timezone} />
                </div>
              </motion.div>
            )}

            {activeTab === 'alerts' && (
              <motion.div
                key="alerts"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-2xl mx-auto"
              >
                <div className="text-center mb-12">
                  <div className="w-16 h-16 bg-rose-500/10 rounded-3xl flex items-center justify-center mx-auto mb-6">
                    <AlertTriangle className="w-8 h-8 text-rose-500" />
                  </div>
                  <h2 className="text-3xl font-bold text-white tracking-tight mb-2">Alert Center</h2>
                  <p className="text-zinc-500">Manage your environmental notifications and safety thresholds.</p>
                </div>

                <div className="space-y-4">
                  <div className="p-6 bg-zinc-900/40 rounded-3xl border border-zinc-800/50">
                    <div className="flex items-center gap-3">
                      <Mail className="w-5 h-5 text-indigo-400" />
                      <div>
                        <h3 className="text-white font-medium">Email Recipient</h3>
                        <p className="text-sm text-zinc-500">Confirm an inbox before PiAQ sends real alert emails.</p>
                      </div>
                    </div>

                    <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                      <input
                        aria-label="Alert email recipient"
                        type="email"
                        value={alertEmailInput}
                        onChange={(e) => setAlertEmailInput(e.target.value)}
                        placeholder="name@example.com"
                        className="min-w-0 flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500"
                      />
                      <button
                        onClick={sendAlertEmailConfirmation}
                        disabled={isAlertEmailBusy || !alertEmailInput}
                        className="rounded-xl border border-indigo-500/30 bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Send Confirmation
                      </button>
                    </div>

                    <div className="mt-4 text-sm text-zinc-500">
                      {alertEmailSettings?.recipientEmail ? (
                        <span className="text-emerald-400">Confirmed: {alertEmailSettings.recipientEmail}</span>
                      ) : alertEmailSettings?.pendingRecipientEmail ? (
                        <span className="text-amber-300">Pending confirmation: {alertEmailSettings.pendingRecipientEmail}</span>
                      ) : (
                        <span>No confirmed recipient yet.</span>
                      )}
                    </div>
                  </div>

                  <div className="p-6 bg-zinc-900/40 rounded-3xl border border-zinc-800/50">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h3 className="text-white font-medium">Email Alerts</h3>
                        <p className="text-sm text-zinc-500">Send one combined email when one or more sensors are above threshold.</p>
                      </div>
                      <button
                        onClick={() => saveAlertEmailSettings({ enabled: !alertEmailSettings?.enabled })}
                        disabled={isAlertEmailBusy || !alertEmailSettings?.recipientEmail}
                        aria-label="Toggle email alerts"
                        className={cn(
                          "w-12 h-6 rounded-full p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                          alertEmailSettings?.enabled ? "bg-indigo-600" : "bg-zinc-800"
                        )}
                      >
                        <span className={cn(
                          "block w-4 h-4 bg-white rounded-full transition-transform",
                          alertEmailSettings?.enabled ? "translate-x-6" : "translate-x-0"
                        )} />
                      </button>
                    </div>

                    <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                      <div>
                        <label className="text-[10px] uppercase tracking-widest text-zinc-500">Repeat Alert Interval</label>
                        <select
                          aria-label="Repeat Alert Interval"
                          className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
                          value={alertEmailSettings?.repeatIntervalMinutes || 20}
                          disabled={isAlertEmailBusy || !alertEmailSettings}
                          onChange={(e) => saveAlertEmailSettings({ repeatIntervalMinutes: Number(e.target.value) })}
                        >
                          {[5, 10, 20, 30, 60, 120, 360, 1440].map((mins) => (
                            <option key={mins} value={mins}>
                              {mins < 60 ? `${mins} minutes` : `${mins / 60} hour${mins === 60 ? '' : 's'}`}
                            </option>
                          ))}
                        </select>
                      </div>

                      <button
                        onClick={sendAlertEmailTest}
                        disabled={isAlertEmailBusy || !alertEmailSettings?.enabled}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Send className="h-4 w-4" />
                        Send Test
                      </button>
                    </div>
                  </div>
                </div>

                {(alertEmailStatus || alertEmailSettings?.emailDeliveryConfigured === false) && (
                  <div className="mt-12 p-6 bg-indigo-600/10 rounded-3xl border border-indigo-500/20 flex gap-4">
                    <Info className="w-6 h-6 text-indigo-400 flex-shrink-0" />
                    <p className="text-sm text-indigo-300 leading-relaxed">
                      {alertEmailStatus || 'Email delivery is not configured on the backend yet.'}
                    </p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6">
          <div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-950/90 p-6 shadow-2xl backdrop-blur-md">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Settings</h2>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="rounded-xl border border-zinc-800 bg-white/5 px-3 py-1 text-xs uppercase tracking-widest text-zinc-300 hover:bg-white/10"
              >
                Close
              </button>
            </div>

            <p className="mt-2 text-xs text-zinc-500">Saved locally on this device.</p>

            <div className="mt-6 space-y-4">
              <div>
                <label className="text-[10px] uppercase tracking-widest text-zinc-500">Temperature Units</label>
                <select
                  aria-label="Temperature Units"
                  className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
                  value={settings.temperatureUnit}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      temperatureUnit: e.target.value === 'F' ? 'F' : 'C'
                    }))
                  }
                >
                  <option value="C">Celsius (°C)</option>
                  <option value="F">Fahrenheit (°F)</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-widest text-zinc-500">Auto Refresh Interval</label>
                <select
                  aria-label="Auto Refresh Interval"
                  className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
                  value={settings.refreshIntervalMinutes}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      refreshIntervalMinutes: Number(e.target.value)
                    }))
                  }
                >
                  {[1, 5, 10, 15].map((mins) => (
                    <option key={mins} value={mins}>
                      {mins} minute{mins === 1 ? '' : 's'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-widest text-zinc-500">Timezone</label>
                <select
                  aria-label="Timezone"
                  className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
                  value={settings.timezone}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      timezone: e.target.value === 'UTC' ? 'UTC' : 'local'
                    }))
                  }
                >
                  <option value="local">Local</option>
                  <option value="UTC">UTC</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer / Status Bar */}
      <footer className="fixed bottom-0 left-20 right-0 h-8 border-t border-zinc-800/50 bg-black/80 backdrop-blur-sm px-8 flex items-center justify-between z-40">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] uppercase tracking-widest text-zinc-500">System Online</span>
          </div>
          <div className="w-px h-3 bg-zinc-800" />
          <span className="text-[10px] uppercase tracking-widest text-zinc-500">Device ID: {deviceId}</span>
        </div>
        <span className="text-[10px] uppercase tracking-widest text-zinc-600 font-mono">
          Last Sync: {currentData ? formatTimestamp(currentData.timestamp, { timezone: settings.timezone, includeSeconds: true }) : '--:--:--'}
        </span>
      </footer>
    </div>
  );
}
