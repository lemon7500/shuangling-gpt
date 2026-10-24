'use strict';

// 暂停后 seek 等场景会请求字节区间。明确返回区间与长度，保持媒体响应语义完整；
// 不把单次解码失败归因于 Range（服务器也可以选择忽略 Range 并返回完整的 200）。
function createAssetResponse(data, range, sourceHeaders = {}, method = 'GET') {
  const size = data.byteLength;
  const headers = { ...sourceHeaders, 'accept-ranges': 'bytes', 'content-length': String(size) };
  const body = value => method === 'HEAD' ? null : value;
  if (!range || !/^bytes=/i.test(range)) return new Response(body(new Uint8Array(data)), { status: 200, headers });
  const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
  const unsatisfied = () => new Response(null, { status: 416, headers: { ...headers, 'content-length': '0', 'content-range': 'bytes */' + size } });
  if (!match || (!match[1] && !match[2]) || size === 0) return unsatisfied();
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return unsatisfied();
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return unsatisfied();
    end = Math.min(end, size - 1);
  }
  return new Response(body(new Uint8Array(data.subarray(start, end + 1))), { status: 206,
    headers: { ...headers, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${size}` } });
}

module.exports = { createAssetResponse };
