# Optional offline media audits

These developer tools inspect existing Shuangling WebM files. They are not required to install or run the pet, do not call a generation service, and never rewrite the input media. Audit output may include JSON, a contact sheet and a proposed cleanup runtime; output is staging material for review, not an installation step.

The supported tools are:

- `audit-frost-large-only.py`: examines every positive-alpha component, protects nearby character detail, and produces masks for small detached decoration. This is the current large-snowflake-only audit. The synthetic safety tests are in `tests/media/frost-large-only.test.py`.
- `audit-frost-matte.py`: an older, narrower cool-color/translucency audit, retained for comparison. Its masks should not be treated as equivalent to the current audit. `--emit` and the final step of `--full` write only a proposed runtime into the QA output folder; they do not copy it into the source helper or an installed pet.

## Optional dependencies

Use Python 3.10 or newer. A separate Python environment is recommended. If you choose to run a scan or the synthetic mask tests, install the optional dependencies yourself:

```powershell
python -m pip install -r tools/requirements-media-audit.txt
```

NumPy and Pillow are used by both audits; OpenCV (`opencv-python`) is needed only by the large-only audit. FFmpeg must be installed separately and provide the `libvpx-vp9` decoder. Nothing is downloaded or installed by the tools. `--help` works without these optional Python libraries or FFmpeg.

```powershell
python tools/audit-frost-large-only.py --help
python tools/audit-frost-matte.py --help
python -B tests/media/audit-tool-config.test.py
python tests/media/frost-large-only.test.py
```

The configuration suite uses only the Python standard library and small temporary fixtures. It checks dependency-free import/help, checkout-relative paths, QA-only output (including simulated link escapes), the low-space stop, font fallback, and `--emit` isolation without creating system links. It needs no FFmpeg, NumPy, Pillow or OpenCV. The final command uses synthetic arrays and the optional image dependencies to check mask safety. Neither suite decodes media, generates contact sheets or installs masks.

## Paths and configuration

| Option | Environment variable | Default |
| --- | --- | --- |
| `--root` | `SHUANGLING_AUDIT_ROOT` | The source checkout containing the script |
| `--ffmpeg` | `SHUANGLING_FFMPEG` | `ffmpeg` resolved through `PATH` |
| `--output` | `SHUANGLING_AUDIT_OUTPUT` | `ROOT/qa/media-audit/large-only` or `ROOT/qa/media-audit/matte` |
| `--font` | `SHUANGLING_AUDIT_FONT` | Arial or DejaVu Sans when available, otherwise Pillow's default font |
| `--assets` | — | `ROOT/windows/assets/shuangling` |
| `--inventory` | — | `ROOT/reports/windows-assets.json` |

Command-line options take precedence over environment values. Relative output paths are relative to `--root`; the resolved output must be a **subdirectory of `ROOT/qa`**. Outputs into the source helper, asset directory or a path reached through a symlink outside that QA directory are rejected. Explicit input paths are resolved from the current working directory; absolute paths can be used when auditing another checkout.

For example, after installing the optional dependencies and FFmpeg, a deliberately requested single-action audit could be run as:

```powershell
python tools/audit-frost-large-only.py --only idle --output qa/media-audit/idle
```

A full scan checks the inventory SHA-256 before and after decoding. Do not edit input files while a scan is running. A partial `--only` output is not a complete production runtime.

For `audit-frost-matte.py`, no mode flag samples a few frames per action; `--full` audits all native frames. `--emit` reads an existing `all-frame-cleanup-data.json` in the selected output directory and writes `shuangling-frost-cleanup.js` **in that same staging directory only**. It does not require FFmpeg or invoke decoding. `--full` and `--emit` are mutually exclusive.

The large-only tool's `--merge-plan` accepts the existing plan format (`seedData`, `seedAudit`, `outputDir`, optional `inventory`, and reviewed `changes`). An explicit `--output` or output environment value overrides the plan's `outputDir`; all choices remain subject to the QA-directory restriction. Plan input paths follow the same current-working-directory rule as other explicit inputs. A merge still verifies unchanged source bindings and every changed candidate before staging output.

## Disk and installation boundaries

Both tools stop when the output filesystem has **3 GiB or less available**, before starting and periodically during decoding and writing. They do not delete anything to free space. Audit results can still be sizable; reserve additional space before deliberately running a full scan.

Source media, `windows/data`, and installed helper files are not output targets. Inspect the staged mask, its exact media hash, protected-body evidence and actual playback before considering a separate reviewed adoption. Running an audit, including `--emit`, never authorizes or performs that adoption.

User data, generated QA folders and local Python caches are excluded from the repository. Keep optional dependencies in your environment rather than adding a machine-specific module path to these scripts.
