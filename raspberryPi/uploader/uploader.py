import requests
import json

class DataUploader:
    def __init__(self, server_url, logger):
        self.server_url = server_url
        self.logger = logger

    def register_device(self, device_id, location_label):
        """
        Registers the Pi with the backend. 
        Matches the POST /devices/register contract.
        """
        url = f"{self.server_url}/devices/register"
        payload = {
            "deviceId": device_id,
            "locationLabel": location_label
        }
        
        try:
            response = requests.post(url, json=payload, timeout=10)
            response.raise_for_status()
            self.logger.info(f"Device registered successfully: {device_id} at {location_label}")
            return True
        except requests.exceptions.RequestException as e:
            self.logger.error(f"Registration failed for {device_id}: {e}")
            return False
    
    def upload_batch(self, payload):
        """
        Uploads a windowed batch of sensor data to the backend.
        Matches the POST /ingest/batch contract.
        """
        url = f"{self.server_url}/ingest/batch"
        try:
            self.logger.debug(f"Attempting to upload batch to {url}")
            response = requests.post(
                url,
                json=payload,
                timeout=10
            )
            
            # This will raise an error if the server returns 4xx or 5xx
            response.raise_for_status()
            
            self.logger.info(f"Batch upload successful: {response.status_code}")
            return True
            
        except requests.exceptions.HTTPError as http_err:
            self.logger.error(f"HTTP error occurred: {http_err} - Response: {response.text}")
        except requests.exceptions.ConnectionError:
            self.logger.error("Connection error: Is the server down or is the Pi offline?")
        except requests.exceptions.Timeout:
            self.logger.error("Upload timed out after 10 seconds.")
        except requests.exceptions.RequestException as e:
            self.logger.error(f"An unexpected upload error occurred: {e}")
            
        return False