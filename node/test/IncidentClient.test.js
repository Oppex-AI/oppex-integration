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

  // 8. logger: a validation warning (blank title) routes through logger.warn, not
  // logger.error — a caller's own mistake, not a delivery failure.
  {
    clearDistCache();
    var sdk8 = require(path.join(DIST_DIR, 'index.js'));
    var warnCalls8 = [];
    var logger8 = {
      warn: function (message) {
        warnCalls8.push(message);
      },
      error: function () {
        throw new Error('logger.error must not be called for a validation warning');
      },
    };
    var client8 = new sdk8.IncidentClient({ apiKey: 'k', serviceKey: 's', logger: logger8 });
    var res8 = await client8.sendIncident({ title: '', source: 'x', severity: sdk8.Severity.LOW });
    assert.strictEqual(res8.successful, false);
    assert.strictEqual(warnCalls8.length, 1, 'a blank title must log via logger.warn exactly once');
    assert.ok(warnCalls8[0].indexOf('title') !== -1);
    await client8.close();
  }

  // 9. logger: a real delivery failure (connection refused, retries exhausted) routes
  // through logger.error, not logger.warn — an operational failure, not caller misuse.
  {
    process.env.OPPEX_TEST_ENDPOINT_URL = 'http://127.0.0.1:1';
    clearDistCache();
    var sdk9 = require(path.join(DIST_DIR, 'index.js'));
    var errorCalls9 = [];
    var logger9 = {
      error: function (message) {
        errorCalls9.push(message);
      },
    };
    var client9 = new sdk9.IncidentClient({ apiKey: 'k', serviceKey: 's', logger: logger9 });
    var sawOnError9 = false;
    client9.sendIncidentAsync(
      { title: 'a', source: 'b', severity: sdk9.Severity.LOW },
      {
        onError: function () {
          sawOnError9 = true;
        },
      },
    );
    await client9.close();
    assert.strictEqual(sawOnError9, true);
    assert.strictEqual(errorCalls9.length, 1, 'a real delivery failure must log via logger.error exactly once');
    delete process.env.OPPEX_TEST_ENDPOINT_URL;
  }

  // 10. logger: a logger method that itself throws when called must never crash the
  // SDK or prevent the normal response — same guarantee as a misbehaving onError/
  // onSuccess callback.
  {
    clearDistCache();
    var sdk10 = require(path.join(DIST_DIR, 'index.js'));
    var brokenLogger = {
      warn: function () {
        throw new Error('this logger implementation is broken');
      },
    };
    var client10 = new sdk10.IncidentClient({ apiKey: 'k', serviceKey: 's', logger: brokenLogger });
    var res10 = await client10.sendIncident({ title: '', source: 'x', severity: sdk10.Severity.LOW });
    assert.strictEqual(res10.successful, false, 'a broken logger must not prevent the normal response');
    await client10.close();
  }

  // 11. close() must let already-queued sendIncidentAsync tasks actually attempt
  // delivery during the drain window, not reject themselves as "closed" — only
  // MAX_CONCURRENCY (2) of these 5 can be running when close() is called; the other
  // 3 are still sitting in the queue, and must still get a real delivery attempt
  // while the transport is still open (it's only torn down after the drain finishes).
  await withServer(
    function (req, res) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, code: 200 }));
    },
    async function (sdk) {
      var client11 = new sdk.IncidentClient({ apiKey: 'k', serviceKey: 's' });
      var succeeded11 = 0;
      var failed11 = 0;
      for (var i = 0; i < 5; i++) {
        client11.sendIncidentAsync(
          { title: 'queued-' + i, source: 'x', severity: sdk.Severity.LOW },
          {
            onSuccess: function () {
              succeeded11++;
            },
            onError: function () {
              failed11++;
            },
          },
        );
      }
      await client11.close();
      assert.strictEqual(succeeded11, 5, 'every queued task must get a real delivery attempt during the drain, not self-reject as closed');
      assert.strictEqual(failed11, 0);
    },
  );

  // 12. "Incident created" (sync) logs only once Oppex confirms with a real
  // incidentId — not merely once local validation passes.
  await withServer(
    function (req, res) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, code: 200, data: 'confirmed-sync-1' }));
    },
    async function (sdk) {
      var infoCalls12 = [];
      var logger12 = {
        info: function (message) {
          infoCalls12.push(message);
        },
      };
      var client12 = new sdk.IncidentClient({ apiKey: 'k', serviceKey: 's', logger: logger12 });
      var res12 = await client12.sendIncident({ title: 'a', source: 'b', severity: sdk.Severity.LOW });
      assert.strictEqual(res12.successful, true);
      assert.strictEqual(infoCalls12.length, 1, '"created" must log exactly once, only after server confirmation');
      assert.ok(infoCalls12[0].indexOf('Incident created (sync)') !== -1);
      assert.ok(infoCalls12[0].indexOf('confirmed-sync-1') !== -1, 'the confirmed incidentId must appear in the log message');
      await client12.close();
    },
  );

  // 13. Same as #12, for the async path — the log fires inside the task, after
  // deliver() resolves, not at validation time.
  await withServer(
    function (req, res) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, code: 200, data: 'confirmed-async-1' }));
    },
    async function (sdk) {
      var infoCalls13 = [];
      var logger13 = {
        info: function (message) {
          infoCalls13.push(message);
        },
      };
      var client13 = new sdk.IncidentClient({ apiKey: 'k', serviceKey: 's', logger: logger13 });
      var sawOnSuccess13 = false;
      client13.sendIncidentAsync(
        { title: 'a', source: 'b', severity: sdk.Severity.LOW },
        {
          onSuccess: function () {
            sawOnSuccess13 = true;
          },
        },
      );
      await client13.close();
      assert.strictEqual(sawOnSuccess13, true);
      assert.strictEqual(infoCalls13.length, 1, '"created" must log exactly once, only after server confirmation');
      assert.ok(infoCalls13[0].indexOf('Incident created (async)') !== -1);
      assert.ok(infoCalls13[0].indexOf('confirmed-async-1') !== -1, 'the confirmed incidentId must appear in the log message');
    },
  );

  // 14. A successful response WITHOUT a real incidentId must not log "created" at
  // all — the confirmation gate is on having a real id to report, not just
  // successful:true.
  await withServer(
    function (req, res) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, code: 200 })); // no `data` field
    },
    async function (sdk) {
      var infoCalls14 = [];
      var logger14 = {
        info: function (message) {
          infoCalls14.push(message);
        },
      };
      var client14 = new sdk.IncidentClient({ apiKey: 'k', serviceKey: 's', logger: logger14 });
      var res14 = await client14.sendIncident({ title: 'a', source: 'b', severity: sdk.Severity.LOW });
      assert.strictEqual(res14.successful, true);
      assert.strictEqual(infoCalls14.length, 0, 'no incidentId in the response must mean no "created" log at all');
      await client14.close();
    },
  );

  // 15. close() must never throw or reject, even if the transport itself fails to
  // close cleanly (e.g. Agent.destroy() throwing) — a caller's shutdown sequence must
  // never blow up because closing sockets happened to fail.
  await withServer(
    function (req, res) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, code: 200 }));
    },
    async function (sdk) {
      var errorCalls15 = [];
      var logger15 = {
        error: function (message) {
          errorCalls15.push(message);
        },
      };
      var client15 = new sdk.IncidentClient({ apiKey: 'k', serviceKey: 's', logger: logger15 });
      client15.transport.closeTransport = function () {
        throw new Error('agent.destroy() blew up');
      };
      await client15.close();
      assert.strictEqual(errorCalls15.length, 1, 'a failed transport close must still be logged');
      assert.ok(errorCalls15[0].indexOf('agent.destroy() blew up') !== -1);
    },
  );

  // 16. No `logger` option passed anywhere: the central Logger singleton must fall
  // back to plain `console` and actually route through it — not silently do nothing.
  // Requires a freshly reloaded module (withServer's clearDistCache()) so this test
  // observes the singleton's true default, unaffected by any earlier test's
  // setLogger() call, which persists process-wide once made.
  await withServer(
    function (req, res) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, code: 200, data: 'confirmed-console-1' }));
    },
    async function (sdk) {
      var originalWarn = console.warn;
      var originalInfo = console.info;
      var originalDebug = console.debug;
      var warnCalls16 = [];
      var infoCalls16 = [];
      var debugCalls16 = [];
      console.warn = function (message) {
        warnCalls16.push(message);
      };
      console.info = function (message) {
        infoCalls16.push(message);
      };
      console.debug = function (message) {
        debugCalls16.push(message);
      };
      try {
        // No `logger` in the options at all.
        var client16 = new sdk.IncidentClient({ apiKey: 'k', serviceKey: 's' });

        // Checked before firing the async call below, deliberately — sendIncidentAsync
        // is fire-and-forget, and its own "created" log would race with (and double
        // up against) this one otherwise.
        var res16 = await client16.sendIncident({ title: 'a', source: 'b', severity: sdk.Severity.LOW });
        assert.strictEqual(res16.successful, true);
        assert.strictEqual(infoCalls16.length, 1, '"created" must reach console.info when no logger is supplied');
        assert.ok(infoCalls16[0].indexOf('confirmed-console-1') !== -1);

        var res16Invalid = await client16.sendIncident({ title: '', source: 'b', severity: sdk.Severity.LOW });
        assert.strictEqual(res16Invalid.successful, false);
        assert.strictEqual(warnCalls16.length, 1, 'a validation failure must reach console.warn when no logger is supplied');

        // "Queued" logs synchronously, before submit() — safe to assert right away.
        client16.sendIncidentAsync({ title: 'a', source: 'b', severity: sdk.Severity.LOW });
        assert.strictEqual(debugCalls16.length, 1, '"queued" must reach console.debug when no logger is supplied');
        assert.ok(debugCalls16[0].indexOf('Incident queued for async delivery') !== -1);

        await client16.close();
      } finally {
        console.warn = originalWarn;
        console.info = originalInfo;
        console.debug = originalDebug;
      }
    },
  );

  console.log('IncidentClient.test.js OK');
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
