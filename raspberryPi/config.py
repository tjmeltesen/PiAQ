# Configuration settings

SERVER_URL = "http://10.0.0.1:5001"  # Private WireGuard IP
UPLOAD_INTERVAL = 60  # Seconds between uploads

DEVICE_ID = "pi-001"
LOCATION_LABEL = "Engineering Lab"

# Sensor settings (modify as needed)
I2C_BUS = 1
SPI_BUS = 0
SPI_DEVICE = 0

PMS5003_UART_PORT = "/dev/serial0"
PMS5003_BAUDRATE = 9600

# Logging
LOG_FILE = "environmental_monitor.log"
LOG_LEVEL = "INFO"