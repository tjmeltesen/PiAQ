from adafruit_pm25.uart import PM25_UART
import serial

class PMS5003Sensor:
    def __init__(self, port="/dev/serial0", baudrate=9600):
        uart = serial.Serial(port, baudrate, timeout=1.5)
        self.sensor = PM25_UART(uart, reset_pin=None)

    def read(self):
        try:
            data = self.sensor.read()
            if not data:
                return None
                
            print(f"FULL SENSOR DATA: {data}")
            return {
                "pm1_0": data["pm10 env"],
                "pm2_5": data["pm25 env"],
                "pm10":  data["pm100 env"]
            }

        except RuntimeError:
            # Common: checksum mismatch → ignore and retry
            return None
        except Exception as e:
            print(f"PMS Error: {e}")
            return None
