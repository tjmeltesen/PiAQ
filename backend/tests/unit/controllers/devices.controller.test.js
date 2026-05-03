const test = require('node:test');
const assert = require('node:assert/strict');

const { loadFresh } = require('../../helpers/module-loader');

function createResponse() {
    return {
        statusCode: null,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        }
    };
}

test('registerDevice responds with a mapped device payload', async () => {
    const calls = [];
    const controller = loadFresh('src/controllers/devices.controller.js', {
        mocks: {
            'src/services/devices.service.js': {
                registerDevice: async (payload) => {
                    calls.push(payload);
                    return {
                        id: 9,
                        device_id: 'pi-001',
                        location_label: 'Atrium',
                        status: 'online',
                        registered_at: '2026-04-23T12:00:00.000Z',
                        last_seen_at: '2026-04-23T12:05:00.000Z'
                    };
                }
            }
        }
    });

    const req = {
        body: {
            deviceId: 'pi-001',
            locationLabel: 'Atrium'
        }
    };
    const res = createResponse();
    let nextCalled = false;

    await controller.registerDevice(req, res, () => {
        nextCalled = true;
    });

    assert.deepEqual(calls, [{
        deviceId: 'pi-001',
        locationLabel: 'Atrium'
    }]);
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.body, {
        message: 'Device registered successfully',
        device: {
            id: 9,
            deviceId: 'pi-001',
            locationLabel: 'Atrium',
            status: 'online',
            registeredAt: '2026-04-23T12:00:00.000Z',
            lastSeenAt: '2026-04-23T12:05:00.000Z'
        }
    });
});

test('registerDevice forwards service errors to next', async () => {
    const expectedError = new Error('db unavailable');
    const controller = loadFresh('src/controllers/devices.controller.js', {
        mocks: {
            'src/services/devices.service.js': {
                registerDevice: async () => {
                    throw expectedError;
                }
            }
        }
    });

    const res = createResponse();
    let receivedError;

    await controller.registerDevice({ body: { deviceId: 'pi-001' } }, res, (error) => {
        receivedError = error;
    });

    assert.equal(receivedError, expectedError);
    assert.equal(res.statusCode, null);
    assert.equal(res.body, null);
});

test('listDevices responds with mapped dashboard devices', async () => {
    const controller = loadFresh('src/controllers/devices.controller.js', {
        mocks: {
            'src/services/devices.service.js': {
                listDevices: async () => ([
                    {
                        id: 9,
                        device_id: 'pi-001',
                        location_label: 'Atrium',
                        status: 'online',
                        registered_at: '2026-04-23T12:00:00.000Z',
                        last_seen_at: '2026-04-23T12:05:00.000Z'
                    }
                ])
            }
        }
    });

    const res = createResponse();

    await controller.listDevices({}, res, assert.fail);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
        devices: [
            {
                id: 9,
                deviceId: 'pi-001',
                locationLabel: 'Atrium',
                status: 'online',
                registeredAt: '2026-04-23T12:00:00.000Z',
                lastSeenAt: '2026-04-23T12:05:00.000Z'
            }
        ]
    });
});

test('deleteDevice responds with a mapped deleted device payload', async () => {
    const calls = [];
    const controller = loadFresh('src/controllers/devices.controller.js', {
        mocks: {
            'src/services/devices.service.js': {
                deleteDevice: async (deviceId) => {
                    calls.push(deviceId);
                    return {
                        id: 9,
                        device_id: deviceId,
                        location_label: 'Atrium',
                        status: 'online',
                        registered_at: '2026-04-23T12:00:00.000Z',
                        last_seen_at: '2026-04-23T12:05:00.000Z'
                    };
                }
            }
        }
    });

    const res = createResponse();

    await controller.deleteDevice({ params: { deviceId: 'pi-001' } }, res, assert.fail);

    assert.deepEqual(calls, ['pi-001']);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
        message: 'Device deleted successfully',
        device: {
            id: 9,
            deviceId: 'pi-001',
            locationLabel: 'Atrium',
            status: 'online',
            registeredAt: '2026-04-23T12:00:00.000Z',
            lastSeenAt: '2026-04-23T12:05:00.000Z'
        }
    });
});

test('getLatestDeviceSummary responds with the latest summary payload', async () => {
    const controller = loadFresh('src/controllers/devices.controller.js', {
        mocks: {
            'src/services/devices.service.js': {
                getLatestDeviceSummary: async () => ({
                    window_start: '2026-04-23T10:00:00.000Z',
                    window_end: '2026-04-23T10:05:00.000Z',
                    sample_count: 15,
                    co2_avg: 620.1,
                    co2_max: 730.5,
                    voc_avg: 102.4,
                    voc_max: 118.2,
                    pm1_0_avg: 1.4,
                    pm2_5_avg: 2.6,
                    pm10_avg: 3.2,
                    temperature: 22.1,
                    humidity: 48.4
                })
            }
        }
    });

    const res = createResponse();

    await controller.getLatestDeviceSummary({ params: { deviceId: 'pi-001' } }, res, assert.fail);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
        deviceId: 'pi-001',
        latest: {
            windowStart: '2026-04-23T10:00:00.000Z',
            windowEnd: '2026-04-23T10:05:00.000Z',
            sampleCount: 15,
            metrics: {
                co2: { avg: 620.1, max: 730.5 },
                voc: { avg: 102.4, max: 118.2 },
                pm1_0: { avg: 1.4, max: 1.4 },
                pm2_5: { avg: 2.6, max: 2.6 },
                pm10: { avg: 3.2, max: 3.2 },
                temperature: { avg: 22.1, max: 22.1 },
                humidity: { avg: 48.4, max: 48.4 }
            }
        }
    });
});

test('getDeviceHistory returns metric-specific chart points', async () => {
    const controller = loadFresh('src/controllers/devices.controller.js', {
        mocks: {
            'src/services/devices.service.js': {
                getDeviceHistory: async ({ deviceId, start, end, bucket, metric }) => ({
                    deviceId,
                    metric,
                    range: { start, end, bucket },
                    points: [
                        {
                            timestamp: '2026-04-23T10:00:00.000Z',
                            avg: 600,
                            min: 580,
                            max: 650
                        }
                    ]
                })
            }
        }
    });

    const req = {
        params: { deviceId: 'pi-001' },
        query: {
            start: '2026-04-23T10:00:00.000Z',
            end: '2026-04-23T11:00:00.000Z',
            bucket: '5m',
            metric: 'co2'
        }
    };
    const res = createResponse();

    await controller.getDeviceHistory(req, res, assert.fail);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
        deviceId: 'pi-001',
        range: {
            start: '2026-04-23T10:00:00.000Z',
            end: '2026-04-23T11:00:00.000Z',
            bucket: '5m'
        },
        metric: 'co2',
        points: [
            {
                timestamp: '2026-04-23T10:00:00.000Z',
                avg: 600,
                min: 580,
                max: 650
            }
        ]
    });
});

test('getDeviceAlerts maps alert rows into the frontend shape', async () => {
    const controller = loadFresh('src/controllers/devices.controller.js', {
        mocks: {
            'src/services/devices.service.js': {
                getDeviceAlerts: async () => ([
                    {
                        id: 33,
                        metric_name: 'humidity',
                        threshold_value: 65,
                        comparison_operator: '>=',
                        started_at: '2026-04-23T10:00:00.000Z',
                        ended_at: '2026-04-23T10:10:00.000Z',
                        peak_value: 68.2,
                        status: 'resolved',
                        message: 'Humidity stayed high for 10 minutes',
                        created_at: '2026-04-23T10:00:30.000Z'
                    }
                ])
            }
        }
    });

    const res = createResponse();

    await controller.getDeviceAlerts(
        {
            params: { deviceId: 'pi-001' },
            query: { status: 'resolved' }
        },
        res,
        assert.fail
    );

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
        deviceId: 'pi-001',
        filters: {
            status: 'resolved'
        },
        alerts: [
            {
                id: 33,
                metricName: 'humidity',
                thresholdValue: 65,
                comparisonOperator: '>=',
                startedAt: '2026-04-23T10:00:00.000Z',
                endedAt: '2026-04-23T10:10:00.000Z',
                peakValue: 68.2,
                status: 'resolved',
                message: 'Humidity stayed high for 10 minutes',
                createdAt: '2026-04-23T10:00:30.000Z'
            }
        ]
    });
});

test('getAlertRules maps alert-rule rows into the frontend shape', async () => {
    const controller = loadFresh('src/controllers/devices.controller.js', {
        mocks: {
            'src/services/devices.service.js': {
                getAlertRules: async () => ([
                    {
                        id: 77,
                        metric_name: 'co2',
                        operator: '>=',
                        threshold_value: 1000,
                        duration_seconds: 300,
                        enabled: true,
                        created_at: '2026-04-27T13:00:00.000Z'
                    }
                ])
            }
        }
    });

    const res = createResponse();

    await controller.getAlertRules({ params: { deviceId: 'pi-001' } }, res, assert.fail);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
        deviceId: 'pi-001',
        rules: [
            {
                id: 77,
                metricName: 'co2',
                operator: '>=',
                thresholdValue: 1000,
                durationSeconds: 300,
                enabled: true,
                createdAt: '2026-04-27T13:00:00.000Z'
            }
        ]
    });
});

test('replaceAlertRules forwards the payload and returns the saved rules', async () => {
    const calls = [];
    const controller = loadFresh('src/controllers/devices.controller.js', {
        mocks: {
            'src/services/devices.service.js': {
                replaceAlertRules: async (payload) => {
                    calls.push(payload);
                    return [
                        {
                            id: 77,
                            metric_name: 'co2',
                            operator: '>=',
                            threshold_value: 1000,
                            duration_seconds: 300,
                            enabled: true,
                            created_at: '2026-04-27T13:00:00.000Z'
                        }
                    ];
                }
            }
        }
    });

    const req = {
        params: { deviceId: 'pi-001' },
        body: {
            rules: [
                {
                    metricName: 'co2',
                    operator: '>=',
                    thresholdValue: 1000,
                    durationSeconds: 300,
                    enabled: true
                }
            ]
        }
    };
    const res = createResponse();

    await controller.replaceAlertRules(req, res, assert.fail);

    assert.deepEqual(calls, [{
        deviceId: 'pi-001',
        rules: [
            {
                metricName: 'co2',
                operator: '>=',
                thresholdValue: 1000,
                durationSeconds: 300,
                enabled: true
            }
        ]
    }]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
        message: 'Alert rules updated successfully',
        deviceId: 'pi-001',
        rules: [
            {
                id: 77,
                metricName: 'co2',
                operator: '>=',
                thresholdValue: 1000,
                durationSeconds: 300,
                enabled: true,
                createdAt: '2026-04-27T13:00:00.000Z'
            }
        ]
    });
});

test('recordDeviceHeartbeat returns the refreshed mapped device payload', async () => {
    const controller = loadFresh('src/controllers/devices.controller.js', {
        mocks: {
            'src/services/devices.service.js': {
                recordDeviceHeartbeat: async (deviceId) => ({
                    id: 14,
                    device_id: deviceId,
                    location_label: 'Lab South',
                    status: 'online',
                    registered_at: '2026-04-23T12:00:00.000Z',
                    last_seen_at: '2026-04-28T15:12:00.000Z'
                })
            }
        }
    });

    const res = createResponse();

    await controller.recordDeviceHeartbeat(
        { params: { deviceId: 'pi-001' } },
        res,
        assert.fail
    );

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
        message: 'Heartbeat recorded successfully',
        device: {
            id: 14,
            deviceId: 'pi-001',
            locationLabel: 'Lab South',
            status: 'online',
            registeredAt: '2026-04-23T12:00:00.000Z',
            lastSeenAt: '2026-04-28T15:12:00.000Z'
        }
    });
});
