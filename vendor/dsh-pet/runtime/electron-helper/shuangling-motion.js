// Public runtime metadata binding; all nine media hashes are unchanged.
(function(target){'use strict';const freeze=o=>{Object.values(o).forEach(v=>{if(v&&typeof v==='object')freeze(v)});return Object.freeze(o)};const profile=freeze({
  "outlineCssPx": 0.45,
  "outlineMaskRoi": {
    "assetRoot": "shuangling",
    "canvas": [
      1280,
      720
    ],
    "sourceRect": [
      368,
      104,
      538,
      592
    ],
    "paddingNativePx": 16,
    "sourceManifestSha256": "1aff3d09f1cb5a3e681da7a8c05f7c7da337ac63dc7a4f34fd6ba6929083a1a4",
    "webmSha256ByAnimation": {
      "idle": "77f1e40eb2f2e39477e03688dff384b74ef260d129a4b5593af974f090e9457d",
      "running-right": "7b1a3bcb50dd5222fe241c17b3c6ae619e8c4c9fe72e9d87991032963f142442",
      "running-left": "66352d3fd1f876dc6f30a5a63b7277ce61455251d23a5b70ad4066a7768a99ec",
      "waving": "3301e7a7a4ad5e2b89a0f17d9c1c5bc045ca79a15aca10689219ea1907d85414",
      "jumping": "fed6dc1d16a55efeb26add3e00155171a3467cf62c3f137bf6ce2f0d9e4a92cd",
      "failed": "73fc0371b0b4cc7a26c038a8f5e68de20617cbfd63cd7f2a86b49e8b548df83c",
      "waiting": "dca0b1829060476bbd16ca455a483f57f759e5b1f10b62edbb77dca3bde15689",
      "running": "650e042d8b317ca4465094af97ed9a33eeb0fa794ecc37d495f9287176bc40a9",
      "review": "b6e5cade85af05bd6881badb52692fa486b02c928c07c420b225f7c0b9ae0643"
    }
  },
  "movement": {
    "startMs": 1200,
    "endMs": 3100,
    "clock": "painted-video-media-time",
    "byAnimation": {
      "running-right": {
        "startMs": 541.6666666666666,
        "endMs": 3666.6666666666665
      },
      "running-left": {
        "startMs": 541.6666666666666,
        "endMs": 3666.6666666666665
      }
    }
  }
});if(typeof module==='object'&&module.exports)module.exports=profile;else target.ShuanglingMotion=profile;})(globalThis);
