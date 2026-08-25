'use strict';

var assert = require('assert');
var path = require('path');

var mod = require(path.join(__dirname, '..', '..', 'dist', 'model', 'IncidentRequest.js'));
var buildIncidentRequest = mod.buildIncidentRequest;

function expectThrows(fn, messageContains) {
  var threw = false;
  try {
    fn();
  } catch (err) {
    threw = true;
    assert.ok(
      err.message.indexOf(messageContains) !== -1,
      'expected error message to contain "' + messageContains + '", got: ' + err.message,
    );
  }
  assert.ok(threw, 'expected function to throw');
}

// Required fields
expectThrows(function () {
  buildIncidentRequest({ title: '', source: 'x', severity: 2 });
}, 'title');

expectThrows(function () {
  buildIncidentRequest({ title: 'a', source: '   ', severity: 2 });
}, 'source');

expectThrows(function () {
  buildIncidentRequest({ title: 'a', source: 'x'.repeat(256), severity: 2 });
}, '255');

expectThrows(function () {
  buildIncidentRequest({ title: 'a', source: 'x', severity: 2, priority: 0 });
}, 'priority');

expectThrows(function () {
  buildIncidentRequest({ title: 'a', source: 'x', severity: 2, priority: 6 });
}, 'priority');

expectThrows(function () {
  buildIncidentRequest({ title: 'a', source: 'x', severity: 2, srcTimestamp: 0 });
}, 'srcTimestamp');

// NaN must be rejected too — every comparison against NaN is false, so a plain range
// check (NaN < 1, NaN > 5) would otherwise let it silently through as "valid," and
// JSON.stringify would then serialize it as null on the wire with no error surfaced.
expectThrows(function () {
  buildIncidentRequest({ title: 'a', source: 'x', severity: 2, priority: NaN });
}, 'priority');

expectThrows(function () {
  buildIncidentRequest({ title: 'a', source: 'x', severity: 2, srcTimestamp: NaN });
}, 'srcTimestamp');

// serviceKey: unlike component/group/type/details, null and '' are valid values in
// their own right (auto-route), not rejected the way a blank component/group/etc. is.
// Only a wrong type is an error.
expectThrows(function () {
  buildIncidentRequest({ title: 'a', source: 'x', severity: 2, serviceKey: 123 });
}, 'serviceKey');

var withNullServiceKey = buildIncidentRequest({ title: 'a', source: 'x', severity: 2, serviceKey: null });
assert.strictEqual(withNullServiceKey.serviceKey, null, 'null serviceKey must pass through, not throw or get coerced');

var withEmptyServiceKey = buildIncidentRequest({ title: 'a', source: 'x', severity: 2, serviceKey: '' });
assert.strictEqual(withEmptyServiceKey.serviceKey, '', 'empty-string serviceKey must pass through, not throw');

var withOmittedServiceKey = buildIncidentRequest({ title: 'a', source: 'x', severity: 2 });
assert.strictEqual(withOmittedServiceKey.serviceKey, undefined, 'an omitted serviceKey stays undefined, distinct from null');

// severity: optional and unguarded, deliberately — the Oppex API itself doesn't
// require it or validate its range, so this SDK doesn't reject anything here either.
// Omitted stays undefined (dropped from the wire, same mechanism as serviceKey
// above); any supplied value, in range or not, passes straight through unchanged.
var withOmittedSeverity = buildIncidentRequest({ title: 'a', source: 'x' });
assert.strictEqual(withOmittedSeverity.severity, undefined, 'an omitted severity stays undefined, not defaulted or rejected');

var withOutOfRangeSeverity = buildIncidentRequest({ title: 'a', source: 'x', severity: 99 });
assert.strictEqual(withOutOfRangeSeverity.severity, 99, 'an out-of-range severity passes through unchanged, not rejected');

var withZeroSeverity = buildIncidentRequest({ title: 'a', source: 'x', severity: 0 });
assert.strictEqual(withZeroSeverity.severity, 0, 'a zero severity passes through unchanged, not rejected');

// Defaults
var req = buildIncidentRequest({ title: 'a', source: 'x', severity: 2 });
assert.strictEqual(req.priority, 1, 'priority defaults to 1');
assert.ok(req.srcTimestamp > 0, 'srcTimestamp defaults to now');
assert.strictEqual(req.severity, 2);

// Optional fields pass through
var full = buildIncidentRequest({
  title: 'a',
  source: 'x',
  severity: 5,
  priority: 3,
  srcTimestamp: 12345,
  serviceKey: 'sk',
  component: 'c',
  group: 'g',
  type: 'ty',
  details: '{"k":"v"}',
});
assert.strictEqual(full.serviceKey, 'sk');
assert.strictEqual(full.component, 'c');
assert.strictEqual(full.group, 'g');
assert.strictEqual(full.type, 'ty');
assert.strictEqual(full.details, '{"k":"v"}');

console.log('incidentRequest.test.js OK');
