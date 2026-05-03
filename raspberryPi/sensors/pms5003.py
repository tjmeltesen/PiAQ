from adafruit_pm25.uart import PM25_UART
import serial

class PMS5003Sensor:
    def __init__(self, port="/dev/serial0", baudrate=9600):
        uart = serial.Serial(port, baudrate, timeout=1.5)
        self.sensor = PM25_UART(uart, reset_pin=None)
        self.sensor.active_mode()

    def read(self):
        try:
            # Clear the old buffer data
            self.sensor.uart.reset_input_buffer()

            time.sleep(0.5)
            
            data = self.sensor.read()
            if not data:
                return None

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
