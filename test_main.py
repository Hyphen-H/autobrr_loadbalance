import sys
import types
import unittest


sys.modules.setdefault("qbittorrentapi", types.SimpleNamespace(Client=object))
sys.modules.setdefault("requests", types.SimpleNamespace(get=None))
sys.modules.setdefault(
    "flask",
    types.SimpleNamespace(
        Flask=object,
        request=types.SimpleNamespace(get_json=lambda: None),
        jsonify=lambda *args, **kwargs: None,
    ),
)

import main


class UploadSpeedSortValueTest(unittest.TestCase):
    def _balancer_with_primary_sort_key(self, sort_key):
        balancer = main.QBittorrentLoadBalancer.__new__(main.QBittorrentLoadBalancer)
        balancer.config = {"primary_sort_key": sort_key}
        return balancer

    def _instance_with_speeds(self, upload_speed=0.0, download_speed=0.0):
        return main.InstanceInfo(
            name="test",
            url="http://example.invalid",
            username="user",
            password="pass",
            upload_speed=upload_speed,
            download_speed=download_speed,
        )

    def test_upload_speed_below_200_kib_is_sorted_as_zero(self):
        balancer = self._balancer_with_primary_sort_key("upload_speed")
        instance = self._instance_with_speeds(upload_speed=199.9)

        self.assertEqual(0.0, balancer._get_primary_sort_value(instance))

    def test_upload_speed_at_200_kib_keeps_actual_value(self):
        balancer = self._balancer_with_primary_sort_key("upload_speed")
        instance = self._instance_with_speeds(upload_speed=200.0)

        self.assertEqual(200.0, balancer._get_primary_sort_value(instance))

    def test_download_speed_sorting_is_not_thresholded(self):
        balancer = self._balancer_with_primary_sort_key("download_speed")
        instance = self._instance_with_speeds(upload_speed=199.9, download_speed=123.4)

        self.assertEqual(123.4, balancer._get_primary_sort_value(instance))


if __name__ == "__main__":
    unittest.main()
