"""Synthetic safety regression for offline detached-point masks."""
import importlib.util
from pathlib import Path
import unittest
import numpy as np

script = Path(__file__).resolve().parents[2] / 'tools' / 'audit-frost-large-only.py'
spec = importlib.util.spec_from_file_location('frost_large_only', script)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class LargeOnlyFrost(unittest.TestCase):
    def frame(self):
        rgba = np.zeros((720, 1280, 4), np.uint8)
        rgba[140:680, 450:820] = [244, 241, 250, 255]
        return rgba

    def clear(self, rgba, rects):
        result = rgba.copy()
        for x, y, w, h in rects:
            result[y:y+h, x:x+w] = 0
        return result

    def test_all_colors_and_opacities_including_faint_white_are_removed(self):
        rgba = self.frame()
        for n, pixel in enumerate([[255, 255, 255, 255], [100, 98, 94, 230], [65, 50, 220, 40], [255, 255, 255, 1]]):
            rgba[100:104, 100 + n * 40:104 + n * 40] = pixel
        rects, report = audit.inspect(rgba)
        self.assertEqual(len(rects), 4)
        self.assertEqual(report['protectedNearBody'], 0)
        cleaned = self.clear(rgba, rects)
        self.assertEqual(audit.inspect(cleaned)[0], [])
        np.testing.assert_array_equal(cleaned[140:680, 450:820], rgba[140:680, 450:820])

    def test_nearby_detached_hair_and_ornament_are_protected(self):
        rgba = self.frame()
        rgba[200:204, 444:448] = [245, 245, 255, 255]
        rects, report = audit.inspect(rgba)
        self.assertEqual(rects, [])
        self.assertEqual(report['protectedNearBody'], 1)

    def test_neighboring_point_cannot_clear_a_rejected_ornament(self):
        rgba = self.frame()
        rgba[200:204, 444:448] = [245, 245, 255, 255]
        rgba[200:204, 438:442] = [100, 80, 210, 120]
        rects, _ = audit.inspect(rgba)
        cleaned = self.clear(rgba, rects)
        np.testing.assert_array_equal(cleaned[200:204, 444:448], rgba[200:204, 444:448])

    def test_readable_large_branched_snowflake_is_protected(self):
        rgba = self.frame()
        rgba[75:116, 119:122] = [220, 215, 255, 255]
        rgba[94:97, 100:141] = [220, 215, 255, 255]
        rects, _ = audit.inspect(rgba)
        self.assertEqual(rects, [])

    def test_large_faint_matte_cloud_is_removed_without_touching_opaque_wing(self):
        rgba = self.frame()
        rgba[70:150, 100:180] = [235, 225, 255, 3]
        rgba[70:110, 220:260] = [235, 225, 255, 255]
        rects, _ = audit.inspect(rgba)
        self.assertEqual(len(rects), 1)
        cleaned = self.clear(rgba, rects)
        self.assertEqual(int(cleaned[70:150, 100:180, 3].sum()), 0)
        np.testing.assert_array_equal(cleaned[70:110, 220:260], rgba[70:110, 220:260])

    def test_connected_detail_is_never_cut_out_of_character(self):
        rgba = self.frame()
        rgba[250:252, 430:451] = [244, 241, 250, 24]
        rects, _ = audit.inspect(rgba)
        self.assertEqual(rects, [])

    def test_rectangles_stay_inside_canvas_even_on_edges(self):
        rgba = self.frame()
        rgba[:3, :3] = [250, 250, 250, 90]
        rgba[-3:, -3:] = [250, 250, 250, 255]
        rects, _ = audit.inspect(rgba)
        self.assertEqual(len(rects), 2)
        for x, y, w, h in rects:
            self.assertTrue(x >= 0 and y >= 0 and x+w <= 1280 and y+h <= 720)

    def test_every_real_clear_rectangle_misses_materialized_protected_foreground(self):
        rgba = self.frame()
        rgba[300:304, 444:448] = [250, 250, 255, 255]
        rgba[300:304, 438:442] = [200, 200, 255, 80]
        rgba[100:104, 100:104] = [250, 250, 250, 255]
        rects, report = audit.inspect(rgba, include_guard=True)
        self.assertGreater(len(rects), 0)
        cleared = np.zeros((720, 1280), bool)
        for x, y, w, h in rects:
            cleared[y:y+h, x:x+w] = True
        self.assertEqual(int(np.count_nonzero(cleared & report['_protected'])), 0)
        self.assertTrue(report['_protected'][300:304, 444:448].all())

    def test_sparse_faint_cloud_bbox_can_enclose_body_without_erasing_it(self):
        rgba = self.frame()
        # A ring's bbox overlaps the genuine opaque wing. Exact positive-alpha
        # row runs must leave that wing and its three-pixel buffer intact.
        rgba[80:85, 92:148] = [200, 200, 220, 3]
        rgba[135:140, 92:148] = [200, 200, 220, 3]
        rgba[80:140, 92:97] = [200, 200, 220, 3]
        rgba[80:140, 143:148] = [200, 200, 220, 3]
        rgba[100:120, 110:130] = [240, 240, 250, 255]
        rects, report = audit.inspect(rgba, include_guard=True)
        self.assertGreater(report['exactRunRectangles'], 0)
        cleaned = self.clear(rgba, rects)
        np.testing.assert_array_equal(cleaned[100:120, 110:130], rgba[100:120, 110:130])
        self.assertEqual(int(cleaned[80:85, 92:148, 3].sum()), 0)
        cleared = np.zeros((720, 1280), bool)
        for x, y, w, h in rects:
            cleared[y:y+h, x:x+w] = True
        self.assertEqual(int(np.count_nonzero(cleared & report['_protected'])), 0)


if __name__ == '__main__':
    unittest.main()
