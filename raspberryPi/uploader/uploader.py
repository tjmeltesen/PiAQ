from urllib.parse import urljoin

import requests

class DataUploader:
    def __init__(self, server_url, logger):
        self.server_url = server_url.rstrip('/') + '/'
        self.logger = logger
        self.session = requests.Session()

    def _build_url(self, path):
        return urljoin(self.server_url, path.lstrip('/'))

    @staticmethod
    def _get_response_text(response):
        try:
            return response.text
        except Exception:
            return "<unavailable>"

    def _post_json(self, path, payload, action_label):
        url = self._build_url(path)

        try:
            self.logger.debug(f"{action_label}: POST {url}")
            response = self.session.post(url, json=payload, timeout=10)
            response.raise_for_status()
            self.logger.info(f"{action_label} successful: {response.status_code}")
            return True
        except requests.exceptions.HTTPError as http_err:
            response_text = self._get_response_text(http_err.response)
            self.logger.error(
                f"{action_label} failed with HTTP error: {http_err}. Response: {response_text}"
            )
        except requests.exceptions.ConnectionError:
            self.logger.error(f"{action_label} failed: backend unreachable or Pi offline.")
        except requests.exceptions.Timeout:
            self.logger.error(f"{action_label} timed out after 10 seconds.")
        except requests.exceptions.RequestException as request_err:
            self.logger.error(f"{action_label} failed with request error: {request_err}")

        return False

    def close(self):
        self.session.close()

    def register_device(self, device_id, location_label):
        """
        Registers the Pi with the backend.
        Matches the POST /devices/register contract.
        """
        payload = {
            "deviceId": device_id,
            "locationLabel": location_label
        }

        success = self._post_json('/devices/register', payload, 'Device registration')
        if success:
            self.logger.info(f"Registered device {device_id} at {location_label}")
        return success

    def send_heartbeat(self, device_id):
        """
        Refreshes the device last-seen timestamp without waiting for a batch upload.
        Matches the POST /devices/:deviceId/heartbeat contract.
        """
        return self._post_json(
            f'/devices/{device_id}/heartbeat',
            {},
            f'Heartbeat for {device_id}'
        )

    def upload_batch(self, payload):
        """
        Uploads a windowed batch of sensor data to the backend.
        Matches the POST /ingest/batch contract.
        """
        return self._post_json('/ingest/batch', payload, 'Batch upload')
