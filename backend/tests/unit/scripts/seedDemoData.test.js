const test = require('node:test');
const assert = require('node:assert/strict');

const { loadFresh } = require('../../helpers/module-loader');

test('seedDemoData seeds demo devices, history, sync state, and alerts with a single cleanup delete', async () => {
    const queries = [];
    const evaluatedDeviceIds = [];
    let released = false;
    let poolEnded = false;

    const client = {
        query: async (query, values) => {
            const trimmedQuery = query.trim();
            queries.push({ query: trimmedQuery, values });

            if (trimmedQuery === 'BEGIN' || trimmedQuery === 'COMMIT') {
                return {};
            }

            if (/DELETE FROM devices/i.test(trimmedQuery)) {
                return { rows: [] };
            }

            if (/INSERT INTO devices/i.test(trimmedQuery)) {
                const deviceId = values[0];
                return {
                    rows: [{
                        id: deviceId === 'pi-demo-101' ? 101 : 202,
                        device_id: deviceId,
                        location_label: values[1]
                    }]
                };
            }

            if (/DELETE FROM alert_rules/i.test(trimmedQuery) || /DELETE FROM sensor_readings/i.test(trimmedQuery)) {
                return { rows: [] };
            }

            if (/INSERT INTO alert_rules/i.test(trimmedQuery)
                || /INSERT INTO sensor_readings/i.test(trimmedQuery)
                || /INSERT INTO device_sync_state/i.test(trimmedQuery)) {
                return { rows: [] };
            }

            throw new Error(`Unexpected query: ${trimmedQuery}`);
        },
        release: () => {
            released = true;
        }
    };

    const script = loadFresh('src/scripts/seedDemoData.js', {
        mocks: {
            'src/config/db.js': {
                connect: async () => client,
                end: async () => {
                    poolEnded = true;
                }
            },
            'src/services/alert.service.js': {
                evaluateAlertsForDevice: async (dbClient, deviceId) => {
                    assert.equal(dbClient, client);
                    evaluatedDeviceIds.push(deviceId);
                }
            }
        }
    });

    const originalConsoleLog = console.log;
    const logLines = [];
    console.log = (...args) => {
        logLines.push(args.join(' '));
    };

    try {
        await script.seedDemoData();
    } finally {
        console.log = originalConsoleLog;
    }

    assert.equal(released, true);
    assert.equal(poolEnded, true);
    assert.deepEqual(evaluatedDeviceIds, [101, 202]);
    assert.ok(queries.some((entry) => entry.query === 'BEGIN'));
    assert.ok(queries.some((entry) => entry.query === 'COMMIT'));
    assert.equal(queries.filter((entry) => /DELETE FROM devices/i.test(entry.query)).length, 1);
    assert.ok(
        queries.filter((entry) => /INSERT INTO sensor_readings/i.test(entry.query)).length > 0,
        'expected sensor history to be inserted'
    );
    assert.ok(
        queries.filter((entry) => /INSERT INTO device_sync_state/i.test(entry.query)).length >= 2,
        'expected device sync state to be created for demo devices'
    );
    assert.ok(logLines.some((line) => line.includes('Demo data seeded successfully.')));
    assert.ok(logLines.some((line) => line.includes('GET /devices/pi-demo-101/latest')));
    assert.ok(logLines.some((line) => line.includes('GET /devices/pi-demo-202/alerts')));
});
