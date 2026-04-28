const test = require('node:test');
const assert = require('node:assert/strict');

const { loadFresh } = require('../../helpers/module-loader');

test('registerDevice upserts a device and returns the inserted row', async () => {
    const capturedCalls = [];
    const expectedRow = {
        id: 3,
        device_id: 'pi-001',
        location_label: 'Engineering Lab',
        status: 'online',
        registered_at: '2026-04-23T12:00:00.000Z',
        last_seen_at: '2026-04-23T12:00:00.000Z'
    };

    const service = loadFresh('src/services/devices.service.js', {
        mocks: {
            'src/config/db.js': {
                query: async (query, values) => {
                    capturedCalls.push({ query, values });
                    return { rows: [expectedRow] };
                }
            }
        }
    });

    const result = await service.registerDevice({
        deviceId: 'pi-001',
        locationLabel: 'Engineering Lab'
    });

    assert.deepEqual(result, expectedRow);
    assert.equal(capturedCalls.length, 1);
    assert.match(capturedCalls[0].query, /INSERT INTO devices/i);
    assert.match(capturedCalls[0].query, /ON CONFLICT \(device_id\)/i);
    assert.deepEqual(capturedCalls[0].values, ['pi-001', 'Engineering Lab']);
});

test('registerDevice stores a null location label when one is not provided', async () => {
    let capturedValues;

    const service = loadFresh('src/services/devices.service.js', {
        mocks: {
            'src/config/db.js': {
                query: async (query, values) => {
                    capturedValues = values;
                    return { rows: [{ id: 7, device_id: 'pi-002' }] };
                }
            }
        }
    });

    await service.registerDevice({ deviceId: 'pi-002' });

    assert.deepEqual(capturedValues, ['pi-002', null]);
});

test('listDevices returns rows in stable dashboard order', async () => {
    const capturedCalls = [];
    const expectedRows = [
        { id: 1, device_id: 'pi-001' },
        { id: 2, device_id: 'pi-002' }
    ];

    const service = loadFresh('src/services/devices.service.js', {
        mocks: {
            'src/config/db.js': {
                query: async (query, values) => {
                    capturedCalls.push({ query, values });
                    return { rows: expectedRows };
                }
            }
        }
    });

    const result = await service.listDevices();

    assert.deepEqual(result, expectedRows);
    assert.equal(capturedCalls.length, 1);
    assert.match(capturedCalls[0].query, /ORDER BY COALESCE\(location_label, device_id\) ASC, device_id ASC/i);
    assert.equal(capturedCalls[0].values, undefined);
});

test('getLatestDeviceSummary returns the most recent reading for a known device', async () => {
    const capturedCalls = [];
    const latestRow = {
        window_start: '2026-04-23T10:00:00.000Z',
        window_end: '2026-04-23T10:05:00.000Z',
        sample_count: 10,
        co2_avg: 600.1,
        co2_max: 720.4
    };

    const service = loadFresh('src/services/devices.service.js', {
        mocks: {
            'src/config/db.js': {
                query: async (query, values) => {
                    capturedCalls.push({ query, values });

                    if (/FROM devices/i.test(query)) {
                        return {
                            rows: [{ id: 42, device_id: 'pi-001' }]
                        };
                    }

                    if (/FROM sensor_readings/i.test(query)) {
                        return {
                            rows: [latestRow]
                        };
                    }

                    throw new Error(`Unexpected query: ${query}`);
                }
            }
        }
    });

    const result = await service.getLatestDeviceSummary('pi-001');

    assert.deepEqual(result, latestRow);
    assert.equal(capturedCalls.length, 2);
    assert.deepEqual(capturedCalls[0].values, ['pi-001']);
    assert.deepEqual(capturedCalls[1].values, [42]);
    assert.match(capturedCalls[1].query, /ORDER BY window_end DESC, window_start DESC/i);
});

test('getDeviceHistory buckets readings for a requested metric', async () => {
    const capturedCalls = [];

    const service = loadFresh('src/services/devices.service.js', {
        mocks: {
            'src/config/db.js': {
                query: async (query, values) => {
                    capturedCalls.push({ query, values });

                    if (/FROM devices/i.test(query)) {
                        return {
                            rows: [{ id: 7, device_id: 'pi-001' }]
                        };
                    }

                    if (/AVG\(co2_avg\)::float8 AS avg_value/i.test(query)) {
                        return {
                            rows: [
                                {
                                    bucket_start: '2026-04-23T10:00:00.000Z',
                                    avg_value: 610.3,
                                    min_value: 590.2,
                                    max_value: 701.1
                                }
                            ]
                        };
                    }

                    throw new Error(`Unexpected query: ${query}`);
                }
            }
        }
    });

    const result = await service.getDeviceHistory({
        deviceId: 'pi-001',
        start: '2026-04-23T10:00:00.000Z',
        end: '2026-04-23T11:00:00.000Z',
        bucket: '5m',
        metric: 'co2'
    });

    assert.deepEqual(result, {
        deviceId: 'pi-001',
        metric: 'co2',
        range: {
            start: '2026-04-23T10:00:00.000Z',
            end: '2026-04-23T11:00:00.000Z',
            bucket: '5m'
        },
        points: [
            {
                timestamp: '2026-04-23T10:00:00.000Z',
                avg: 610.3,
                min: 590.2,
                max: 701.1
            }
        ]
    });
    assert.equal(capturedCalls.length, 2);
    assert.deepEqual(capturedCalls[1].values, [7, '2026-04-23T10:00:00.000Z', '2026-04-23T11:00:00.000Z', 300]);
});

test('getDeviceHistory returns empty chart points when no readings exist in range', async () => {
    const service = loadFresh('src/services/devices.service.js', {
        mocks: {
            'src/config/db.js': {
                query: async (query) => {
                    if (/FROM devices/i.test(query)) {
                        return {
                            rows: [{ id: 7, device_id: 'pi-001' }]
                        };
                    }

                    if (/FROM sensor_readings/i.test(query)) {
                        return { rows: [] };
                    }

                    throw new Error(`Unexpected query: ${query}`);
                }
            }
        }
    });

    const result = await service.getDeviceHistory({
        deviceId: 'pi-001',
        start: '2026-04-23T10:00:00.000Z',
        end: '2026-04-23T11:00:00.000Z',
        bucket: '15m',
        metric: 'temperature'
    });

    assert.deepEqual(result.points, []);
});

test('getDeviceAlerts returns active alerts followed by recent resolved alerts', async () => {
    const capturedCalls = [];

    const service = loadFresh('src/services/devices.service.js', {
        mocks: {
            'src/config/db.js': {
                query: async (query, values) => {
                    capturedCalls.push({ query, values });

                    if (/FROM devices/i.test(query)) {
                        return {
                            rows: [{ id: 18, device_id: 'pi-001' }]
                        };
                    }

                    if (/status = 'active'/i.test(query)) {
                        return {
                            rows: [{ id: 1, status: 'active' }]
                        };
                    }

                    if (/status = 'resolved'/i.test(query)) {
                        return {
                            rows: [{ id: 2, status: 'resolved' }]
                        };
                    }

                    throw new Error(`Unexpected query: ${query}`);
                }
            }
        }
    });

    const result = await service.getDeviceAlerts({ deviceId: 'pi-001' });

    assert.deepEqual(result, [
        { id: 1, status: 'active' },
        { id: 2, status: 'resolved' }
    ]);
    assert.equal(capturedCalls.length, 3);
    assert.deepEqual(capturedCalls[0].values, ['pi-001']);
    assert.deepEqual(capturedCalls[1].values, [18]);
    assert.deepEqual(capturedCalls[2].values, [18]);
});

test('getDeviceAlerts throws a 404 when the device is unknown', async () => {
    const service = loadFresh('src/services/devices.service.js', {
        mocks: {
            'src/config/db.js': {
                query: async () => ({ rows: [] })
            }
        }
    });

    await assert.rejects(
        service.getDeviceAlerts({ deviceId: 'missing-device' }),
        (error) => {
            assert.equal(error.message, 'Unknown deviceId: missing-device');
            assert.equal(error.status, 404);
            return true;
        }
    );
});

test('getAlertRules returns device-specific rules in stable order', async () => {
    const capturedCalls = [];
    const service = loadFresh('src/services/devices.service.js', {
        mocks: {
            'src/config/db.js': {
                query: async (query, values) => {
                    capturedCalls.push({ query, values });

                    if (/FROM devices/i.test(query)) {
                        return { rows: [{ id: 55, device_id: 'pi-001' }] };
                    }

                    if (/FROM alert_rules/i.test(query)) {
                        return {
                            rows: [
                                {
                                    id: 4,
                                    metric_name: 'co2',
                                    operator: '>=',
                                    threshold_value: 1000,
                                    duration_seconds: 300,
                                    enabled: true,
                                    created_at: '2026-04-27T13:00:00.000Z'
                                }
                            ]
                        };
                    }

                    throw new Error(`Unexpected query: ${query}`);
                }
            }
        }
    });

    const result = await service.getAlertRules('pi-001');

    assert.deepEqual(result, [
        {
            id: 4,
            metric_name: 'co2',
            operator: '>=',
            threshold_value: 1000,
            duration_seconds: 300,
            enabled: true,
            created_at: '2026-04-27T13:00:00.000Z'
        }
    ]);
    assert.equal(capturedCalls.length, 2);
    assert.deepEqual(capturedCalls[0].values, ['pi-001']);
    assert.deepEqual(capturedCalls[1].values, [55]);
});

test('replaceAlertRules replaces a device rule set inside a transaction', async () => {
    const calls = [];
    let released = false;

    const client = {
        query: async (query, values) => {
            calls.push({ query, values });

            if (query === 'BEGIN' || query === 'COMMIT') {
                return {};
            }

            if (/FROM devices/i.test(query)) {
                return { rows: [{ id: 9, device_id: 'pi-001' }] };
            }

            if (/DELETE FROM alert_rules/i.test(query)) {
                return { rows: [] };
            }

            if (/INSERT INTO alert_rules/i.test(query)) {
                return { rows: [] };
            }

            if (/SELECT\s+id,\s+metric_name/i.test(query) && /FROM alert_rules/i.test(query)) {
                return {
                    rows: [
                        {
                            id: 2,
                            metric_name: 'co2',
                            operator: '>=',
                            threshold_value: 1000,
                            duration_seconds: 300,
                            enabled: true,
                            created_at: '2026-04-27T13:00:00.000Z'
                        }
                    ]
                };
            }

            throw new Error(`Unexpected query: ${query}`);
        },
        release: () => {
            released = true;
        }
    };

    const service = loadFresh('src/services/devices.service.js', {
        mocks: {
            'src/config/db.js': {
                connect: async () => client
            }
        }
    });

    const result = await service.replaceAlertRules({
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
    });

    assert.deepEqual(result, [
        {
            id: 2,
            metric_name: 'co2',
            operator: '>=',
            threshold_value: 1000,
            duration_seconds: 300,
            enabled: true,
            created_at: '2026-04-27T13:00:00.000Z'
        }
    ]);
    assert.equal(released, true);
    assert.equal(calls[0].query, 'BEGIN');
    assert.equal(calls.at(-1).query, 'COMMIT');
});

test('recordDeviceHeartbeat updates last_seen_at and keeps the device online', async () => {
    const calls = [];
    const service = loadFresh('src/services/devices.service.js', {
        mocks: {
            'src/config/db.js': {
                query: async (query, values) => {
                    calls.push({ query, values });

                    if (/UPDATE devices/i.test(query)) {
                        return {
                            rows: [{
                                id: 12,
                                device_id: 'pi-001',
                                location_label: 'Engineering Lab',
                                status: 'online',
                                registered_at: '2026-04-23T12:00:00.000Z',
                                last_seen_at: '2026-04-28T15:12:00.000Z'
                            }]
                        };
                    }

                    throw new Error(`Unexpected query: ${query}`);
                }
            }
        }
    });

    const result = await service.recordDeviceHeartbeat('pi-001');

    assert.deepEqual(result, {
        id: 12,
        device_id: 'pi-001',
        location_label: 'Engineering Lab',
        status: 'online',
        registered_at: '2026-04-23T12:00:00.000Z',
        last_seen_at: '2026-04-28T15:12:00.000Z'
    });
    assert.deepEqual(calls[0].values, ['pi-001']);
});

test('recordDeviceHeartbeat throws a 404 when the device is unknown', async () => {
    const service = loadFresh('src/services/devices.service.js', {
        mocks: {
            'src/config/db.js': {
                query: async () => ({ rows: [] })
            }
        }
    });

    await assert.rejects(
        service.recordDeviceHeartbeat('pi-missing'),
        (error) => {
            assert.equal(error.message, 'Unknown deviceId: pi-missing');
            assert.equal(error.status, 404);
            return true;
        }
    );
});
