'use strict';

var assert = require('assert');
var path = require('path');

var wireCodec = require(path.join(__dirname, '..', '..', 'dist', 'internal', 'wire', 'wireCodec.js'));
var serializeRequest = wireCodec.serializeRequest;
var parseResponse = wireCodec.parseResponse;

// Exact field order, optional fields present
var full = serializeRequest({
  serviceKey: 'sk',
  title: 't',
  source: 's',
  severity: 4,
  priority: 2,
  srcTimestamp: 999,
  component: 'c',
  group: 'g',
  type: 'ty',
  details: '{"a":1}',
});
var parsedFull = JSON.parse(full);
assert.deepStrictEqual(
  Object.keys(parsedFull),
  ['serviceKey', 'title', 'source', 'severity', 'priority', 'srcTimestamp', 'component', 'group', 'type', 'detailsJSON'],
  'field order must match exactly',
);
assert.strictEqual(parsedFull.detailsJSON, '{"a":1}');

// serviceKey: undefined (never specified anywhere) is dropped from the wire entirely,
// same as component/group/type/details when unset — but null and '' are NOT treated
// the same as undefined. They are meaningful values in their own right (Oppex reads
// either as "auto-route this incident") and must be sent on the wire literally.
var minimal = serializeRequest({
  title: 't',
  source: 's',
  severity: 1,
  priority: 1,
  srcTimestamp: 1,
});
var parsedMinimal = JSON.parse(minimal);
assert.deepStrictEqual(Object.keys(parsedMinimal), ['title', 'source', 'severity', 'priority', 'srcTimestamp']);
assert.ok(!('serviceKey' in parsedMinimal), 'a truly undefined serviceKey must be dropped, not sent as null');
assert.ok(!('detailsJSON' in parsedMinimal));

var nullServiceKey = JSON.parse(
  serializeRequest({ title: 't', source: 's', severity: 1, priority: 1, srcTimestamp: 1, serviceKey: null }),
);
assert.strictEqual(nullServiceKey.serviceKey, null, 'an explicit null serviceKey must be sent literally, not dropped');

var emptyServiceKey = JSON.parse(
  serializeRequest({ title: 't', source: 's', severity: 1, priority: 1, srcTimestamp: 1, serviceKey: '' }),
);
assert.strictEqual(emptyServiceKey.serviceKey, '', 'an explicit empty-string serviceKey must be sent literally, not dropped');

// parseResponse: well-formed JSON
var ok = parseResponse(200, JSON.stringify({ success: true, code: 200, message: 'ok', data: 'inc-1' }));
assert.strictEqual(ok.successful, true);
assert.strictEqual(ok.incidentId, 'inc-1');

// parseResponse: empty body defaults
var empty2xx = parseResponse(204, '');
assert.strictEqual(empty2xx.successful, true);
assert.strictEqual(empty2xx.code, 204);
assert.strictEqual(empty2xx.incidentId, null);

var empty5xx = parseResponse(503, '');
assert.strictEqual(empty5xx.successful, false);

// parseResponse: defensive parsing — non-JSON body must never throw
var html = parseResponse(502, '<html><body>Bad Gateway</body></html>');
assert.strictEqual(html.successful, false);
assert.strictEqual(html.code, 502);

// parseResponse: a non-JSON body's raw content must never appear in the returned
// message — a misbehaving proxy/WAF could echo request headers (including
// X-API-KEY) into a non-JSON error page, and leaking any of that raw text into a log
// line or response.message would leak the secret into the host application's logs.
var leaky = parseResponse(502, '<html>X-API-KEY: super-secret-value should never appear</html>');
assert.strictEqual(leaky.message.indexOf('super-secret-value'), -1, 'raw non-JSON body content must not leak into message');
assert.strictEqual(leaky.message.indexOf('X-API-KEY'), -1, 'raw non-JSON body content must not leak into message');

// parseResponse: a 2xx with success:false is still returned as a response, not thrown
var successFalse2xx = parseResponse(200, JSON.stringify({ success: false, code: 200, message: 'business failure' }));
assert.strictEqual(successFalse2xx.successful, false);
assert.strictEqual(successFalse2xx.code, 200);

console.log('wireCodec.test.js OK');
