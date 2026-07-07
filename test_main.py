import sys
import threading
import types
import unittest
from unittest import mock


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

    def test_upload_speed_below_threshold_kib_is_sorted_as_zero(self):
        balancer = self._balancer_with_primary_sort_key("upload_speed")
        instance = self._instance_with_speeds(
            upload_speed=main.UPLOAD_SPEED_SORT_ZERO_THRESHOLD_KIB - 0.1
        )

        self.assertEqual(0.0, balancer._get_primary_sort_value(instance))

    def test_upload_speed_at_threshold_kib_keeps_actual_value(self):
        balancer = self._balancer_with_primary_sort_key("upload_speed")
        instance = self._instance_with_speeds(
            upload_speed=main.UPLOAD_SPEED_SORT_ZERO_THRESHOLD_KIB
        )

        self.assertEqual(
            main.UPLOAD_SPEED_SORT_ZERO_THRESHOLD_KIB,
            balancer._get_primary_sort_value(instance),
        )

    def test_download_speed_sorting_is_not_thresholded(self):
        balancer = self._balancer_with_primary_sort_key("download_speed")
        instance = self._instance_with_speeds(upload_speed=199.9, download_speed=123.4)

        self.assertEqual(123.4, balancer._get_primary_sort_value(instance))

    def test_upload_download_speed_sorting_combines_upload_sort_value_and_download_speed(self):
        balancer = self._balancer_with_primary_sort_key("upload_download_speed")
        instance = self._instance_with_speeds(
            upload_speed=main.UPLOAD_SPEED_SORT_ZERO_THRESHOLD_KIB,
            download_speed=123.4,
        )

        self.assertEqual(
            main.UPLOAD_SPEED_SORT_ZERO_THRESHOLD_KIB
            * main.UPLOAD_DOWNLOAD_SORT_UPLOAD_WEIGHT
            + 123.4 * main.UPLOAD_DOWNLOAD_SORT_DOWNLOAD_WEIGHT,
            balancer._get_primary_sort_value(instance),
        )

    def test_upload_download_speed_sorting_treats_low_upload_as_zero(self):
        balancer = self._balancer_with_primary_sort_key("upload_download_speed")
        instance = self._instance_with_speeds(
            upload_speed=main.UPLOAD_SPEED_SORT_ZERO_THRESHOLD_KIB - 0.1,
            download_speed=123.4,
        )

        self.assertEqual(
            123.4 * main.UPLOAD_DOWNLOAD_SORT_DOWNLOAD_WEIGHT,
            balancer._get_primary_sort_value(instance),
        )

    def test_total_downloads_sorting_combines_active_and_waiting_downloads(self):
        balancer = self._balancer_with_primary_sort_key("total_downloads")
        instance = self._instance_with_speeds()
        instance.active_downloads = 3
        instance.new_tasks_count = 10
        instance.waiting_downloads_count = 4

        self.assertEqual(5.0, balancer._get_primary_sort_value(instance))


class AddTorrentRefreshTest(unittest.TestCase):
    class FakeClient:
        def __init__(self, result="Ok."):
            self.result = result
            self.add_params = None

        def torrents_add(self, **kwargs):
            self.add_params = kwargs
            return self.result

    def _balancer(self):
        balancer = main.QBittorrentLoadBalancer.__new__(main.QBittorrentLoadBalancer)
        balancer.config = {"debug_add_stopped": False}
        balancer.status_refresh_event = threading.Event()
        return balancer

    def _instance(self, client):
        return main.InstanceInfo(
            name="test",
            url="http://example.invalid",
            username="user",
            password="pass",
            client=client,
            active_downloads=2,
        )

    def test_successful_add_optimistically_increments_active_downloads_and_requests_refresh(self):
        balancer = self._balancer()
        instance = self._instance(self.FakeClient())
        torrent = main.PendingTorrent(
            download_url="magnet:?xt=urn:btih:test",
            release_name="test-release",
            category="movies",
        )

        self.assertTrue(balancer._add_torrent_to_instance(instance, torrent))

        self.assertEqual(3, instance.active_downloads)
        self.assertTrue(balancer.status_refresh_event.is_set())

    def test_requested_status_refresh_waits_before_returning_to_refresh_loop(self):
        balancer = self._balancer()
        balancer.status_refresh_event.set()

        with mock.patch.object(main.time, "sleep") as sleep:
            balancer._wait_for_next_status_refresh(30)

        sleep.assert_called_once_with(main.STATUS_REFRESH_AFTER_ADD_DELAY)


class InstanceMetricsLoggingTest(unittest.TestCase):
    def test_speed_log_uses_mb_for_rates_at_least_one_mib(self):
        balancer = main.QBittorrentLoadBalancer.__new__(main.QBittorrentLoadBalancer)
        instance = main.InstanceInfo(
            name="test",
            url="http://example.invalid",
            username="user",
            password="pass",
        )
        maindata = {
            "server_state": {
                "up_info_speed": int(1.5 * main.BYTES_TO_KB * main.BYTES_TO_KB),
                "dl_info_speed": 512 * main.BYTES_TO_KB,
                "free_space_on_disk": 100 * main.BYTES_TO_GB,
            },
            "torrents": {},
        }

        with mock.patch.object(main.logger, "debug") as debug:
            balancer._update_instance_metrics(instance, maindata)

        log_message = debug.call_args.args[0]
        self.assertIn("上传=1.5MB/s", log_message)
        self.assertIn("下载=512.0KB/s", log_message)

    def test_metrics_count_waiting_downloads_from_qbittorrent_states(self):
        balancer = main.QBittorrentLoadBalancer.__new__(main.QBittorrentLoadBalancer)
        instance = main.InstanceInfo(
            name="test",
            url="http://example.invalid",
            username="user",
            password="pass",
        )
        maindata = {
            "server_state": {},
            "torrents": {
                "active": types.SimpleNamespace(state="downloading"),
                "stalled": types.SimpleNamespace(state="stalledDL"),
                "queued": types.SimpleNamespace(state="queuedDL"),
                "metadata": types.SimpleNamespace(state="metaDL"),
                "paused": types.SimpleNamespace(state="pausedDL"),
            },
        }

        balancer._update_instance_metrics(instance, maindata)

        self.assertEqual(1, instance.active_downloads)
        self.assertEqual(3, instance.waiting_downloads_count)


class StatusUpdateTest(unittest.TestCase):
    class FakeClient:
        def sync_maindata(self):
            return {
                "server_state": {
                    "up_info_speed": 0,
                    "dl_info_speed": 0,
                    "free_space_on_disk": 0,
                },
                "torrents": {},
            }

    def test_single_instance_update_refreshes_metrics_from_maindata(self):
        balancer = main.QBittorrentLoadBalancer.__new__(main.QBittorrentLoadBalancer)
        balancer.config = {}
        instance = main.InstanceInfo(
            name="test",
            url="http://example.invalid",
            username="user",
            password="pass",
            client=self.FakeClient(),
        )

        balancer._update_single_instance(instance)

        self.assertEqual(1, instance.success_metrics_count)


if __name__ == "__main__":
    unittest.main()
