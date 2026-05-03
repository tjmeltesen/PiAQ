import time
import board
import busio
import statistics
from datetime import datetime, timezone

# Import your configuration
from config import (
    SERVER_URL,
    UPLOAD_INTERVAL,
    HEARTBEAT_INTERVAL,
    PMS5003_UART_PORT,
    PMS5003_BAUDRATE,
    DEVICE_ID,
    LOCATION_LABEL
)

from uploader.uploader import DataUploader
from utils.logger import setup_logger
from sensors import SCD40Sensor, SGP40Sensor, PMS5003Sensor

def collect_raw_sample(scd, sgp, pms, logger=None):
    """Collects one single snapshot from all sensors."""
    sample = {}
    
    # 1. Read SCD40 (The context provider)
    temp = None
    hum = None
    try:
        scd_data = scd.read()
        if scd_data:
            sample.update(scd_data)
            temp = scd_data.get('temp')
            hum = scd_data.get('hum')
    except Exception as e:
        if logger:
            logger.warning(f"SCD40 read failed: {e}")

    # 2. Read PMS5003
    try:
        pm_data = pms.read()
        if pm_data:
            sample.update(pm_data)
    except Exception as e:
        if logger:
            logger.warning(f"PMS5003 read failed: {e}")

    # 3. Read SGP40 (Using SCD40 compensation)
    try:
        voc_data = sgp.read(temp=temp, hum=hum)
        if voc_data:
            sample.update(voc_data)
    except Exception as e:
        if logger:
            logger.warning(f"SGP40 read failed: {e}")
        
    return sample

def metric_values(buffer, key):
    return [s[key] for s in buffer if key in s and s[key] is not None]

def mean_or_none(buffer, key):
    values = metric_values(buffer, key)
    return statistics.mean(values) if values else None

def max_or_none(buffer, key):
    values = metric_values(buffer, key)
    return max(values) if values else None

def add_summary_metric(reading, field, value):
    if value is not None:
        reading[field] = value

def main():
    logger = setup_logger()
    logger.info("Starting PiAQ Environmental Monitor")

    # Initialize Hardware
    try:
        i2c = busio.I2C(board.SCL, board.SDA)
        scd40 = SCD40Sensor(i2c)
        sgp40 = SGP40Sensor(i2c)
        pms5003 = PMS5003Sensor(PMS5003_UART_PORT, PMS5003_BAUDRATE)
        uploader = DataUploader(SERVER_URL, logger)
    except Exception as e:
        logger.error(f"Hardware Init Failed: {e}")
        return
    
    # Registration with server
    registered = uploader.register_device(DEVICE_ID, LOCATION_LABEL)
    if not registered:
        logger.warning("Initial registration failed. Will attempt to ingest anyways, but errors may occur.")
        isRegistered = False
    else:
        isRegistered = True

    buffer = []
    window_start = datetime.now(timezone.utc).isoformat()
    last_upload_time = time.time()
    last_heartbeat_time = last_upload_time

    failedBeats = 0

    while True:
        try:
            # 1. Collect a single sample
            sample = collect_raw_sample(scd40, sgp40, pms5003, logger)
            if sample:
                buffer.append(sample)
            
            # 2. Check if the window is closed (reached UPLOAD_INTERVAL)
            # We check time instead of count to keep the window consistent
            current_time = time.time()
            elapsed_time = current_time - last_upload_time

            if elapsed_time >= UPLOAD_INTERVAL and len(buffer) > 0:
                window_end = datetime.now(timezone.utc).isoformat()

                # Reattempt registration if not registered
                if not isRegistered:
                    registered = uploader.register_device(DEVICE_ID, LOCATION_LABEL)
                    if not registered:
                        logger.warning("Initial registration failed. Will attempt to ingest anyways, but errors may occur.")
                        isRegistered = False
                    else:
                        isRegistered = True

                # 3. Calculate the Summary for the Backend Contract
                reading = {
                    "windowStart": window_start,
                    "windowEnd": window_end,
                    "sampleCount": len(buffer)
                }

                add_summary_metric(reading, "co2_avg", mean_or_none(buffer, "co2"))
                add_summary_metric(reading, "co2_max", max_or_none(buffer, "co2"))
                add_summary_metric(reading, "voc_avg", mean_or_none(buffer, "voc_index"))
                add_summary_metric(reading, "voc_max", max_or_none(buffer, "voc_index"))
                add_summary_metric(reading, "pm1_0_avg", mean_or_none(buffer, "pm1_0"))
                add_summary_metric(reading, "pm2_5_avg", mean_or_none(buffer, "pm2_5"))
                add_summary_metric(reading, "pm10_avg", mean_or_none(buffer, "pm10"))
                add_summary_metric(reading, "temperature", mean_or_none(buffer, "temp"))
                add_summary_metric(reading, "humidity", mean_or_none(buffer, "hum"))

                payload = {
                    "deviceId": DEVICE_ID,
                    "readings": [reading]
                }

                # Extract the summary for easier logging
                summary = {
                    "co2_avg": float("nan"),
                    "voc_avg": float("nan"),
                    "pm1_0_avg": float("nan"),
                    "pm2_5_avg": float("nan"),
                    "pm10_avg": float("nan"),
                    "temperature": float("nan"),
                    "humidity": float("nan"),
                    **payload["readings"][0]
                }

                logger.info(
                    f"Window Summary: CO2: {summary['co2_avg']:.1f}ppm, "
                    f"VOC: {summary['voc_avg']:.1f}, "
                    f"PM1.0: {summary['pm1_0_avg']:0.1f}µg/m³, "
                    f"PM2.5: {summary['pm2_5_avg']:.1f}µg/m³, "
                    f"PM10: {summary['pm10_avg']:.1f}µg/m³, "
                    f"Temp: {summary['temperature']:.1f}°C, "
                    f"Hum: {summary['humidity']:.1f}°C"
                )

                # 4. Upload to the new /ingest/batch endpoint
                success = uploader.upload_batch(payload)
                
                if success:
                    logger.info(f"Uploaded window with {len(buffer)} samples.")
                    buffer = [] # Clear the buffer
                    window_start = window_end # Set new start time
                    last_upload_time = current_time
                    last_heartbeat_time = current_time
                else:
                    logger.warning("Upload failed, keeping data in buffer for next attempt.")

            elif current_time - last_heartbeat_time >= HEARTBEAT_INTERVAL:
                if uploader.send_heartbeat(DEVICE_ID):
                    logger.info(f"Heartbeat sent for {DEVICE_ID}.")
                    last_heartbeat_time = current_time
                    failedBeats = 0
                else:
                    logger.warning("Heartbeat failed; will retry on the next interval.")
                    failedBeats++
                    if failedBeats > 2:
                        isRegistered = false
                    

        except Exception as e:
            logger.exception(f"Unexpected error in main loop: {e}")

        # Take a reading every 5 seconds (gives you ~6 samples per 30 second window)
        time.sleep(5)

if __name__ == "__main__":
    main()
