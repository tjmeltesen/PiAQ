import React, { useState, useMemo, useEffect, useRef } from 'react';
import { format, parseISO } from 'date-fns';
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
  Bell
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AirQualityData } from './types';
import { POLLUTANTS } from './constants';
import { getDeviceHistoryWindow, TimeWindow } from './services/airQualityService';
import { AirQualityCard } from './components/AirQualityCard';
import { AqiGauge } from './components/AqiGauge';
import { HistoricalChart } from './components/HistoricalChart';
import { InsightsPanel } from './components/InsightsPanel';
import { AlertsBanner } from './components/AlertsBanner';
import { cn } from './lib/utils';

export default function App() {
  const [deviceId] = useState('AU-9821-X');
  const [data, setData] = useState<AirQualityData[]>([]);
  const [selectedPollutant, setSelectedPollutant] = useState<keyof AirQualityData>('pm25');
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('1d');
  const [timeWindowLabel, setTimeWindowLabel] = useState('Last 24 hours');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'history' | 'alerts'>('dashboard');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const placeholderRef = useRef<AirQualityData>({
    timestamp: new Date().toISOString(),
    aqi: 0,
    pm25: 0,
    pm10: 0,
    co: 0,
    so2: 0,
    no2: 0,
    o3: 0,
    co2: 0,
    voc: 0,
    temp: 0,
    humidity: 0,
  });

  const currentData = useMemo(() => data[data.length - 1], [data]);
  const hasData = !!currentData;
  const displayCurrentData = currentData || placeholderRef.current;

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

  useEffect(() => {
    mountedRef.current = true;
    refreshData();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!mountedRef.current) return;
    refreshData();
  }, [timeWindow]);


  return (
    <div className="min-h-screen bg-black text-zinc-300 font-sans selection:bg-indigo-500/30">
      {/* Sidebar Navigation */}
      <aside className="fixed left-0 top-0 bottom-0 w-20 border-r border-zinc-800/50 bg-zinc-950/50 backdrop-blur-xl z-50 flex flex-col items-center py-8 gap-8">
        <div className="w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-[0_0_20px_rgba(79,70,229,0.4)]">
          <Wind className="w-6 h-6 text-white" />
        </div>
        
        <nav className="flex flex-col gap-4">
          <button 
            onClick={() => setActiveTab('dashboard')}
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
          <button className="p-3 rounded-xl text-zinc-600 hover:text-zinc-400 transition-colors">
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
                  {hasData ? `${displayCurrentData.temp}°C` : '--'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Droplets className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-medium text-white">
                  {hasData ? `${displayCurrentData.humidity}%` : '--'}
                </span>
              </div>
            </div>

            <button 
              onClick={() => refreshData({ forceRefresh: true })}
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
                      data={data}
                      dataKey={selectedPollutant}
                      color="#6366f1"
                      label={POLLUTANTS[selectedPollutant as string]?.name || (selectedPollutant as string)}
                      windowLabel={timeWindowLabel}
                    />
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
                  <HistoricalChart data={data} dataKey="aqi" color="#10b981" label="AQI" windowLabel={timeWindowLabel} />
                  <HistoricalChart data={data} dataKey="pm25" color="#6366f1" label="PM2.5" windowLabel={timeWindowLabel} />
                  <HistoricalChart data={data} dataKey="co2" color="#f59e0b" label="CO2" windowLabel={timeWindowLabel} />
                  <HistoricalChart data={data} dataKey="voc" color="#8b5cf6" label="VOC" windowLabel={timeWindowLabel} />
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
                  {[
                    { title: 'High PM2.5 Alert', desc: 'Notify when PM2.5 exceeds 35µg/m³', active: true },
                    { title: 'CO2 Ventilation Warning', desc: 'Notify when CO2 exceeds 1000ppm', active: true },
                    { title: 'VOC Spike Detected', desc: 'Notify when VOC levels rise rapidly', active: false },
                    { title: 'Health Recommendations', desc: 'Daily AI-powered health insights', active: true },
                  ].map((alert, i) => (
                    <div key={i} className="p-6 bg-zinc-900/40 rounded-3xl border border-zinc-800/50 flex items-center justify-between">
                      <div>
                        <h3 className="text-white font-medium">{alert.title}</h3>
                        <p className="text-sm text-zinc-500">{alert.desc}</p>
                      </div>
                      <div className={cn(
                        "w-12 h-6 rounded-full p-1 transition-colors cursor-pointer",
                        alert.active ? "bg-indigo-600" : "bg-zinc-800"
                      )}>
                        <div className={cn(
                          "w-4 h-4 bg-white rounded-full transition-transform",
                          alert.active ? "translate-x-6" : "translate-x-0"
                        )} />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-12 p-6 bg-indigo-600/10 rounded-3xl border border-indigo-500/20 flex gap-4">
                  <Info className="w-6 h-6 text-indigo-400 flex-shrink-0" />
                  <p className="text-sm text-indigo-300 leading-relaxed">
                    Alerts are currently simulated based on your threshold settings. In a production environment, these would be sent via push notifications or email.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

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
          Last Sync: {currentData ? format(parseISO(currentData.timestamp), 'HH:mm:ss') : '--:--:--'}
        </span>
      </footer>
    </div>
  );
}
