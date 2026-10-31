"""Portable synthetic audit contracts; no media, FFmpeg or image libraries needed."""
import importlib.util
import json
import os
from pathlib import Path
import py_compile
import shutil
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


SOURCE = Path(__file__).resolve().parents[2]
MIN_FREE = 3 * 1024 ** 3


def clean_environment():
    """Do not inherit a developer's audit paths or local module search path."""
    return {
        **{key: value for key, value in os.environ.items()
           if not key.startswith('SHUANGLING_') and key != 'PYTHONPATH'},
        'PYTHONDONTWRITEBYTECODE': '1',
    }


def load_audit(script):
    spec = importlib.util.spec_from_file_location('synthetic_audit', script)
    module = importlib.util.module_from_spec(spec)
    with patch.dict(os.environ, clean_environment(), clear=True), patch.object(sys, 'dont_write_bytecode', True):
        spec.loader.exec_module(module)
    return module


class SyntheticFixture(unittest.TestCase):
    def setUp(self):
        # Even the small test-owned fixtures respect the audit's free-space floor.
        if shutil.disk_usage(tempfile.gettempdir()).free <= MIN_FREE:
            self.skipTest('At most 3 GiB free on the temporary filesystem; no fixtures written')
        self.temporary = tempfile.TemporaryDirectory(prefix='shuangling-audit-test-')
        self.addCleanup(self.temporary.cleanup)
        self.fixture = Path(self.temporary.name).resolve() / 'source fixture'
        self.fixture.mkdir()

    def run_python(self, *arguments, env=None):
        return subprocess.run(
            [sys.executable, '-S', *map(str, arguments)],
            cwd=self.fixture, env=env or clean_environment(),
            capture_output=True, text=True, timeout=20, check=True,
        )


class AuditContract:
    filename = None

    def setUp(self):
        super().setUp()
        self.script = SOURCE / 'tools' / self.filename
        self.audit = load_audit(self.script)
        self.audit.ROOT = self.fixture
        self.output = self.fixture / 'qa' / 'nested'
        self.audit.OUT = self.output

    def test_import_without_optional_dependencies_uses_checkout_root(self):
        code = (
            'import importlib.util,json,sys; '
            's=importlib.util.spec_from_file_location("audit",sys.argv[1]); '
            'm=importlib.util.module_from_spec(s); s.loader.exec_module(m); '
            'print(json.dumps({"root":str(m.ROOT),'
            '"optionalLoaded":[n for n in ("numpy","PIL","cv2") if n in sys.modules]}))'
        )
        result = json.loads(self.run_python('-c', code, self.script).stdout)
        self.assertEqual(Path(result['root']), SOURCE)
        self.assertEqual(result['optionalLoaded'], [])
        self.assertEqual(list(self.fixture.iterdir()), [])

    def test_compiles_without_writing_source_cache(self):
        # Explicit cfile keeps compilation products in the test-owned fixture.
        target = self.fixture / 'synthetic-audit.pyc'
        py_compile.compile(str(self.script), cfile=str(target), doraise=True)
        self.assertTrue(target.is_file())

    def test_help_works_without_site_libraries_or_ffmpeg(self):
        env = {**clean_environment(), 'SHUANGLING_FFMPEG': 'nonexistent-synthetic-ffmpeg'}
        result = self.run_python(self.script, '--help', env=env)
        for option in ['--root', '--output', '--ffmpeg', '--font']:
            self.assertIn(option, result.stdout)
        self.assertEqual(list(self.fixture.iterdir()), [])

    def test_output_must_be_a_strict_qa_subdirectory(self):
        self.assertEqual(self.audit.staging_dir('qa/nested'), self.output)
        for unsafe in ['qa', 'qa/../vendor', '../outside', self.fixture / 'vendor' / 'helper']:
            with self.subTest(output=str(unsafe)), self.assertRaises(RuntimeError):
                self.audit.staging_dir(unsafe)
        self.assertFalse(self.output.exists())

    def test_rejects_a_qa_root_link_escape_without_creating_links(self):
        original_resolve = Path.resolve
        qa = self.fixture / 'qa'
        external = self.fixture / 'vendor' / 'synthetic-linked-output'

        def resolve_link(path, *args, **kwargs):
            if path == qa or qa in path.parents:
                return external / path.relative_to(qa)
            return original_resolve(path, *args, **kwargs)

        # Model resolution only: no Windows link privileges or actual links needed.
        with patch.object(Path, 'resolve', autospec=True, side_effect=resolve_link):
            with self.assertRaises(RuntimeError):
                self.audit.staging_dir('qa/nested')
        self.assertFalse(external.exists())

    def test_rejects_an_output_file_link_escape_without_creating_links(self):
        original_resolve = Path.resolve
        target = self.output / 'synthetic-output.json'
        external = self.fixture / 'vendor' / 'synthetic-production.json'

        def resolve_link(path, *args, **kwargs):
            if path == target:
                return external
            return original_resolve(path, *args, **kwargs)

        with patch.object(Path, 'resolve', autospec=True, side_effect=resolve_link):
            with self.assertRaises(RuntimeError):
                self.write_output(target.name, '{}')
        self.assertFalse(self.output.exists())
        self.assertFalse(external.exists())

    def test_low_space_stops_writes_at_and_below_the_floor(self):
        for available in [MIN_FREE, MIN_FREE - 1]:
            with self.subTest(free=available):
                with patch.object(self.audit.shutil, 'disk_usage', return_value=SimpleNamespace(free=available)):
                    with self.assertRaises(RuntimeError):
                        self.write_output('synthetic-output.json', '{}')
                self.assertFalse(self.output.exists())

    def test_missing_truetype_fonts_fall_back_without_image_dependencies(self):
        fallback = object()
        font = SimpleNamespace(
            truetype=Mock(side_effect=OSError('synthetic missing font')),
            load_default=Mock(return_value=fallback),
        )
        loader = 'require_images' if hasattr(self.audit, 'require_images') else 'require_dependencies'
        with patch.object(self.audit, loader), patch.object(self.audit, 'ImageFont', font):
            self.audit.FONT = 'nonexistent-synthetic-font.ttf'
            self.assertIs(self.audit.audit_font(14), fallback)


class LargeOnlyAuditConfig(AuditContract, SyntheticFixture):
    filename = 'audit-frost-large-only.py'

    def write_output(self, name, text):
        self.audit.write_staged(self.output, name, text)


class MatteAuditConfig(AuditContract, SyntheticFixture):
    filename = 'audit-frost-matte.py'

    def write_output(self, name, text):
        self.audit.write_staged(name, text)


class MatteEmitIsolation(SyntheticFixture):
    def test_cli_overrides_environment_and_emit_only_stages_a_proposed_runtime(self):
        tools = self.fixture / 'tools'
        tools.mkdir()
        template = 'const syntheticFixture = __FROST_CLEANUP_DATA__;'
        (tools / 'frost-cleanup-runtime-template.js').write_text(template, encoding='utf-8')
        production = self.fixture / 'vendor' / 'dsh-pet' / 'runtime' / 'electron-helper'
        production.mkdir(parents=True)
        sentinel = production / 'shuangling-frost-cleanup.js'
        sentinel.write_text('untouched synthetic production sentinel', encoding='utf-8')
        output = self.fixture / 'qa' / 'emit-only'
        output.mkdir(parents=True)
        data = {'schema': 'shuangling-gpt/frost-cleanup-v1', 'actions': {}}
        raw = json.dumps(data)
        (output / 'all-frame-cleanup-data.json').write_text(raw, encoding='utf-8')
        before = {p.relative_to(self.fixture): p.read_bytes()
                  for p in self.fixture.rglob('*') if p.is_file()}
        env = {
            **clean_environment(),
            'SHUANGLING_AUDIT_ROOT': str(self.fixture / 'unused-env-root'),
            'SHUANGLING_AUDIT_OUTPUT': 'qa/wrong-env-target',
            'SHUANGLING_FFMPEG': 'nonexistent-synthetic-ffmpeg',
        }
        script = SOURCE / 'tools' / 'audit-frost-matte.py'
        result = json.loads(self.run_python(
            script, '--root', self.fixture, '--output', 'qa/emit-only', '--emit', env=env,
        ).stdout)
        proposed = output / 'shuangling-frost-cleanup.js'
        self.assertTrue(result['stagedOnly'])
        self.assertEqual(Path(result['runtimeFile']), proposed)
        self.assertEqual(proposed.read_text(encoding='utf-8'), template.replace('__FROST_CLEANUP_DATA__', raw))
        after = {p.relative_to(self.fixture): p.read_bytes()
                 for p in self.fixture.rglob('*') if p.is_file()}
        self.assertEqual(set(after) - set(before), {proposed.relative_to(self.fixture)})
        for path, contents in before.items():
            self.assertEqual(after[path], contents, str(path))
        self.assertFalse((self.fixture / 'qa' / 'wrong-env-target').exists())
        self.assertFalse((self.fixture / 'unused-env-root').exists())


if __name__ == '__main__':
    unittest.main()
