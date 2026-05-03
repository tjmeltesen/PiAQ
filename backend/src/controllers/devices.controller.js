const devicesService = require('../services/devices.service');

function mapDevice(device) {
    return {
        id: device.id,
        deviceId: device.device_id,
        locationLabel: device.location_label,
        status: device.status,
        registeredAt: device.registered_at,
        lastSeenAt: device.last_seen_at
    };
}

function mapAlert(alert) {
    return {
        id: alert.id,
        metricName: alert.metric_name,
        thresholdValue: alert.threshold_value,
        comparisonOperator: alert.comparison_operator,
        startedAt: alert.started_at,
        endedAt: alert.ended_at,
        peakValue: alert.peak_value,
        status: alert.status,
        message: alert.message,
        createdAt: alert.created_at
    };
}

function mapAlertRule(rule) {
    return {
        id: rule.id,
        metricName: rule.metric_name,
        operator: rule.operator,
        thresholdValue: rule.threshold_value,
        durationSeconds: rule.duration_seconds,
        enabled: rule.enabled,
        createdAt: rule.created_at
    };
}

async function registerDevice(req, res, next) {
    try {
        const { deviceId, locationLabel } = req.body;

        const device = await devicesService.registerDevice({
            deviceId,
            locationLabel
        });

        res.status(201).json({
            message: 'Device registered successfully',
            device: mapDevice(device)
        });
    } catch (err) {
        next(err);
    }
}

async function listDevices(req, res, next) {
    try {
        const devices = await devicesService.listDevices();

        res.status(200).json({
            devices: devices.map(mapDevice)
        });
    } catch (err) {
        next(err);
    }
}

async function deleteDevice(req, res, next) {
    try {
        const { deviceId } = req.params;
        const device = await devicesService.deleteDevice(deviceId);

        res.status(200).json({
            message: 'Device deleted successfully',
            device: mapDevice(device)
        });
    } catch (err) {
        next(err);
    }
}

async function getLatestDeviceSummary(req, res, next) {
    try {
        const { deviceId } = req.params;
        const latest = await devicesService.getLatestDeviceSummary(deviceId);

        res.status(200).json({
            deviceId,
            latest: latest ? {
                windowStart: latest.window_start,
                windowEnd: latest.window_end,
                sampleCount: latest.sample_count,
                metrics: {
                    co2: {
                        avg: latest.co2_avg,
                        max: latest.co2_max
                    },
                    voc: {
                        avg: latest.voc_avg,
                        max: latest.voc_max
                    },
                    pm1_0: {
                        avg: latest.pm1_0_avg,
                        max: latest.pm1_0_avg
                    },
                    pm2_5: {
                        avg: latest.pm2_5_avg,
                        max: latest.pm2_5_avg
                    },
                    pm10: {
                        avg: latest.pm10_avg,
                        max: latest.pm10_avg
                    },
                    temperature: {
                        avg: latest.temperature,
                        max: latest.temperature
                    },
                    humidity: {
                        avg: latest.humidity,
                        max: latest.humidity
                    }
                }
            } : null
        });
    } catch (err) {
        next(err);
    }
}

async function getDeviceHistory(req, res, next) {
    try {
        const { deviceId } = req.params;
        const { start, end, bucket, metric } = req.query;
        const history = await devicesService.getDeviceHistory({
            deviceId,
            start,
            end,
            bucket,
            metric
        });

        const response = {
            deviceId,
            range: {
                start: history.range.start,
                end: history.range.end,
                bucket: history.range.bucket
            }
        };

        if (history.metric) {
            response.metric = history.metric;
            response.points = history.points;
        } else {
            response.metrics = history.metrics;
        }

        res.status(200).json(response);
    } catch (err) {
        next(err);
    }
}

async function getDeviceAlerts(req, res, next) {
    try {
        const { deviceId } = req.params;
        const { status } = req.query;
        const alerts = await devicesService.getDeviceAlerts({ deviceId, status });

        res.status(200).json({
            deviceId,
            filters: {
                status: status || null
            },
            alerts: alerts.map(mapAlert)
        });
    } catch (err) {
        next(err);
    }
}

async function getAlertRules(req, res, next) {
    try {
        const { deviceId } = req.params;
        const rules = await devicesService.getAlertRules(deviceId);

        res.status(200).json({
            deviceId,
            rules: rules.map(mapAlertRule)
        });
    } catch (err) {
        next(err);
    }
}

async function replaceAlertRules(req, res, next) {
    try {
        const { deviceId } = req.params;
        const { rules } = req.body;
        const savedRules = await devicesService.replaceAlertRules({
            deviceId,
            rules
        });

        res.status(200).json({
            message: 'Alert rules updated successfully',
            deviceId,
            rules: savedRules.map(mapAlertRule)
        });
    } catch (err) {
        next(err);
    }
}

async function recordDeviceHeartbeat(req, res, next) {
    try {
        const { deviceId } = req.params;
        const device = await devicesService.recordDeviceHeartbeat(deviceId);

        res.status(200).json({
            message: 'Heartbeat recorded successfully',
            device: mapDevice(device)
        });
    } catch (err) {
        next(err);
    }
}

module.exports = {
    registerDevice,
    listDevices,
    deleteDevice,
    getLatestDeviceSummary,
    getDeviceHistory,
    getDeviceAlerts,
    getAlertRules,
    replaceAlertRules,
    recordDeviceHeartbeat
};
