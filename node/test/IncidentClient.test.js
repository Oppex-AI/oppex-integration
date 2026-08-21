'use strict';

var assert = require('assert');
var path = require('path');
var http = require('http');

function startServer(handler) {
  return new Promise(function (resolve) {
    var server = http.createServer(handler);
    server.listen(0, '127.0.0.1', function () {
      resolve(server);
    });
  });
}

var DIST_DIR = path.join(__dirname, '..', 'dist');

function clearDistCache() {
  Object.keys(require.cache).forEach(function (key) {
    if (key.indexOf(DIST_DIR) === 0) {
      delete require.cache[key];
    }
  });
}

async function withServer(handler, fn) {
  var server = await startServer(handler);
  process.env.OPPEX_TEST_ENDPOINT_URL = 'http://127.0.0.1:' + server.address().port;
  try {
    // Clear every cached dist/ module, not just index.js/constants.js — IncidentClient.js
    // and internal/transport.js also close over constants.ENDPOINT_URL at require time,
    // and would otherwise keep pointing at a previous test's (now-closed) server.
    clearDistCache();
    var sdk = require(path.join(DIST_DIR, 'index.js'));
    await fn(sdk, server);
  } finally {
    server.close();
    delete process.env.OPPEX_TEST_ENDPOINT_URL;
  }
}

async function main() {
  // 1. Successful round trip, exact wire field order, correct headers.
  await withServer(
    function (req, res) {
      var chunks = [];
      req.on('data', function (c) {
        chunks.push(c);
      });
      req.on('end', function () {
        var body = Buffer.concat(chunks).toString('utf8');
        var parsed = JSON.parse(body);
        assert.deepStrictEqual(Object.keys(parsed), [
          'serviceKey',
          'title',
          'source',
          'severity',
          'priority',
          'srcTimestamp',
        ]);
        assert.strictEqual(req.headers['x-api-key'], 'k');
        assert.strictEqual(req.headers['content-type'], 'application/json');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, code: 200, message: 'ok', data: 'inc-1' }));
      });
    },
    async function (sdk) {
      var client = new sdk.IncidentClient({ apiKey: 'k', serviceKey: 's' });
      var res = await client.sendIncident({ title: 'a', source: 'b', severity: sdk.Severity.HIGH });
      assert.strictEqual(res.successful, true);
      assert.strictEqual(res.incidentId, 'inc-1');
      await client.close();
    },
  );

  // 2. Non-retryable status (401) resolves immediately with the real code, no retry.
  await withServer(
    function (req, res) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, code: 401, message: 'unauthorized' }));
    },
    async function (sdk) {
      var client = new sdk.IncidentClient({ apiKey: 'k', serviceKey: 's' });
      var res = await client.sendIncident({ title: 'a', source: 'b', severity: sdk.Severity.LOW });
      assert.strictEqual(res.successful, false);
      assert.strictEqual(res.code, 401);
      await client.close();
    },
  );

  // 3. Retryable status exhausted (always 502) resolves failed with the real status code
  //    after all retries, never throws. Also exercises defensive non-JSON parsing on the
  //    final attempt's HTML body via the exhaustion path.
  await withServer(
    function (req, res) {
      res.writeHead(502, { 'Content-Type': 'text/html' });
      res.end('<html>Bad Gateway</html>');
    },
    async function (sdk) {
      var client = new sdk.IncidentClient({ apiKey: 'k', serviceKey: 's' });
      var res = await client.sendIncident({ title: 'a', source: 'b', severity: sdk.Severity.LOW });
      assert.strictEqual(res.successful, false);
      assert.strictEqual(res.code, 502);
      await client.close();
    },
  );

  // 4. Retry-then-success: fails once with 503, then succeeds.
  await withServer(
    (function () {
      var callCount = 0;
      return function (req, res) {
        callCount++;
        if (callCount === 1) {
          res.writeHead(503);
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, code: 200 }));
      };
    })(),
    async function (sdk) {
      var client = new sdk.IncidentClient({ apiKey: 'k', serviceKey: 's' });
      var res = await client.sendIncident({ title: 'a', source: 'b', severity: sdk.Severity.LOW });
      assert.strictEqual(res.successful, true);
      await client.close();
    },
  );

  // 5. Network failure (nothing listening) resolves failed with code -1, never throws.
  {
    process.env.OPPEX_TEST_ENDPOINT_URL = 'http://127.0.0.1:1';
    clearDistCache();
    var sdk5 = require(path.join(DIST_DIR, 'index.js'));
    var client5 = new sdk5.IncidentClient({ apiKey: 'k', serviceKey: 's' });
    var res5 = await client5.sendIncident({ title: 'a', source: 'b', severity: sdk5.Severity.LOW });
    assert.strictEqual(res5.successful, false);
    assert.strictEqual(res5.code, -1);
    await client5.close();
    delete process.env.OPPEX_TEST_ENDPOINT_URL;
  }

  // 6. sendIncidentAsync: onSuccess fires, no unhandled rejection, close() drains.
  await withServer(
    function (req, res) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, code: 200 }));
    },
    async function (sdk) {
      var sawUnhandled = false;
      function onUnhandled() {
        sawUnhandled = true;
      }
      process.on('unhandledRejection', onUnhandled);

      var client = new sdk.IncidentClient({ apiKey: 'k', serviceKey: 's' });
      var sawSuccess = false;
      client.sendIncidentAsync(
        { title: 'a', source: 'b', severity: sdk.Severity.LOW },
        {
          onSuccess: function () {
            sawSuccess = true;
          },
        },
      );
      await client.close();
      process.removeListener('unhandledRejection', onUnhandled);
      assert.strictEqual(sawSuccess, true, 'onSuccess must fire before close() resolves');
      assert.strictEqual(sawUnhandled, false, 'must never produce an unhandled rejection');
    },
  );

  // 7. serviceKey: constructor accepts an omitted serviceKey (not an error); an
  // explicit per-request null overrides a real client-level serviceKey and is sent on
  // the wire literally, rather than falling back to the client's key.
  await withServer(
    function (req, res) {
      var chunks = [];
      req.on('data', function (c) {
        chunks.push(c);
      });
      req.on('end', function () {
        var body = Buffer.concat(chunks).toString('utf8');
        var parsed = JSON.parse(body);
        assert.strictEqual(parsed.serviceKey, null, 'an explicit null request.serviceKey must override the client key, not fall back to it');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, code: 200 }));
      });
    },
    async function (sdk) {
      // no serviceKey at all — must not throw.
      var noKeyClient = new sdk.IncidentClient({ apiKey: 'k' });
      await noKeyClient.close();

      var client = new sdk.IncidentClient({ apiKey: 'k', serviceKey: 'real-client-key' });
      var res = await client.sendIncident({ title: 'a', source: 'b', severity: sdk.Severity.LOW, serviceKey: null });
      assert.strictEqual(res.successful, true);
      await client.close();
    },
  );

  console.log('IncidentClient.test.js OK');
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
