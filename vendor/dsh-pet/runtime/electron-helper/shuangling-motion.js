// Public runtime metadata binding; reviewed v1.9 media and preserved baseline assets.
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
      539,
      592
    ],
    "paddingNativePx": 16,
    "sourceManifestSha256": "817e632827121a91f453326728a457d4f970a9c6f8536dd4369a1c126b9d845f",
    "webmSha256ByAnimation": {
      "idle": "77f1e40eb2f2e39477e03688dff384b74ef260d129a4b5593af974f090e9457d",
      "running-right": "ac57643f2f68bf3272ad49706b709bec0873d3c8968103e2979f292de83a169b",
      "running-left": "04f14130a7eab2d5302d2aa7cd9e70b5dba73a3e489e085892777f093000b88f",
      "waving": "56a677055a593b1e43696c0b7679fc7b23bb27f283e55127e76b4c14c62747e2",
      "jumping": "fd3b73102da2078aa04c8a3ad02ae32ea70f07ca48a63a9508cef291ee15fa5e",
      "failed": "73fc0371b0b4cc7a26c038a8f5e68de20617cbfd63cd7f2a86b49e8b548df83c",
      "waiting": "0379f73660dbf0081c6955b29e7691ca87ea49452f4cecc91ee8582f09956251",
      "running": "e5475972e289c4a91ef77b33eb1ba362a649cd6579bed78c032c26371b9ebd17",
      "review": "cd024a61801b4d20e8b215c1beca729066b0b7d4ee351ca0b9058055f58d7070",
      "reading": "88b5cfffa8393a9327ff705fe45bf8d73cefaa2192e6a72275f21b761292ed40",
      "looking-around": "b15e42aefea143cd7c2821400a178457fe3552e9338de3c19dbcf66788b64ae5",
      "stretching-wings": "845d7aca137be3f28bcc8eda786a7e0384ad2b2828fca88ad1f6b330a0507cba",
      "running-classic": "650e042d8b317ca4465094af97ed9a33eeb0fa794ecc37d495f9287176bc40a9",
      "review-classic": "b6e5cade85af05bd6881badb52692fa486b02c928c07c420b225f7c0b9ae0643",
      "waiting-classic": "dca0b1829060476bbd16ca455a483f57f759e5b1f10b62edbb77dca3bde15689",
      "drag-lift": "96c6f1202f7b7416d53ba9f268fa805117d68d2985a9725bd0bcd29ebf204cab",
      "drag-hover": "8b06861df760f0ff75a4efb13d1f1b4e11afd837c23795c5d1f1eb2e169afbcf",
      "drag-lower": "80806540fe1c05da5df17265e93568d10373f89e972eab858564fcf2d289ade8"
    }
  },
  "movement": {
    "startMs": 1200,
    "endMs": 3100,
    "clock": "painted-video-media-time",
    "byAnimation": {
      "running-right": {
        "startMs": 2666.6666666666665,
        "endMs": 7833.333333333333
      },
      "running-left": {
        "startMs": 500,
        "endMs": 3958.3333333333335,
        "accelUntilMs": 1000,
        "decelerateFromMs": 3500
      }
    }
  },
  "dragAssetRoots": [
    "main",
    "shuangling"
  ],
  "drag": {
    "lift": "drag-lift",
    "hover": "drag-hover",
    "lower": "drag-lower"
  }
});if(typeof module==='object'&&module.exports)module.exports=profile;else target.ShuanglingMotion=profile;})(globalThis);
