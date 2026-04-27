import time
import board
import busio
import statistics
from datetime import datetime, timezone

# Import your configuration
from config import (
    SERVER_URL,
    UPLOAD_INTERVAL,  # This should be your window size (e.g., 300 seconds)
    PMS5003_UART_PORT,
    PMS5003_BAUDRATE,
    DEVICE_ID,
    LOCATION_LABEL
)

from uploader.uploader import DataUploader
from utils.logger import setup_logger
from sensors import SCD40Sensor, SGP40Sensor, PMS5003Sensor

def collect_raw_sample(scd, sgp, pms):
    """Collects one single snapshot from all sensors."""
    sample = {}
    
    # 1. Read SCD40 (The context provider)
    scd_data = scd.read()
    temp = None
    hum = None
    if scd_data:
        sample.update(scd_data)
        temp = scd_data.get('temp')
        hum = scd_data.get('hum')

    # 2. Read PMS5003
    pm_data = pms.read()
    if pm_data:
        sample.update(pm_data)

    # 3. Read SGP40 (Using SCD40 compensation)
    voc_data = sgp.read(temp=temp, hum=hum)
    if voc_data:
        sample.update(voc_data)
        
    return sample

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

    buffer = []
    window_start = datetime.now(timezone.utc).isoformat()
    last_upload_time = time.time()

    while True:
        try:
            # 1. Collect a single sample
            sample = collect_raw_sample(scd40, sgp40, pms5003)
            if sample:
                buffer.append(sample)
            
            # 2. Check if the window is closed (reached UPLOAD_INTERVAL)
            # We check time instead of count to keep the window consistent
            current_time = time.time()
            elapsed_time = current_time - last_upload_time

            if elapsed_time >= UPLOAD_INTERVAL and len(buffer) > 0:
                window_end = datetime.now(timezone.utc).isoformat()

                # 3. Calculate the Summary for the Backend Contract
                payload = {
                    "deviceId": DEVICE_ID, # Change to your actual ID
                    "readings": [
                        {
                            "windowStart": window_start,
                            "windowEnd": window_end,
                            "sampleCount": len(buffer),
                            "co2_avg": statistics.mean([s['co2'] for s in buffer if 'co2' in s]),
                            "co2_max": max([s['co2'] for s in buffer if 'co2' in s]),
                            "voc_avg": statistics.mean([s['voc_index'] for s in buffer if 'voc_index' in s]),
                            "voc_max": max([s['voc_index'] for s in buffer if 'voc_index' in s]),
                            "pm1_0_avg": statistics.mean([s['pm1_0'] for s in buffer if 'pm1_0' in s]),
                            "pm2_5_avg": statistics.mean([s['pm2_5'] for s in buffer if 'pm2_5' in s]),
                            "pm10_avg":  statistics.mean([s['pm10'] for s in buffer if 'pm10' in s]),
                            "temperature": statistics.mean([s['temp'] for s in buffer if 'temp' in s]),
                            "humidity":    statistics.mean([s['hum'] for s in buffer if 'hum' in s])
                        }
                    ]
                }

                # 4. Upload to the new /ingest/batch endpoint
                success = uploader.upload_batch(payload)
                
                if success:
                    logger.info(f"Uploaded window with {len(buffer)} samples.")
                    buffer = [] # Clear the buffer
                    window_start = window_end # Set new start time
                else:
                    logger.warning("Upload failed, keeping data in buffer for next attempt.")

        except Exception as e:
            logger.exception(f"Unexpected error in main loop: {e}")

        # Take a reading every 10 seconds (gives you ~30 samples per 5-min window)
        time.sleep(10)

if __name__ == "__main__":
    main()