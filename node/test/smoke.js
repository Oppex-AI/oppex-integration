'use strict';

/*
 * Network-free external-consumer smoke test, mirroring
 * .github/smoke/java/ExternalConsumer.java: constructs and closes a client, validates
 * exported shape and the "never throws" contract, without posting to Oppex. Written in
 * plain, conservative CommonJS (no destructuring, no arrow functions, no let/const-only
 * assumptions beyond what Node 8 supports) so it runs unmodified as the CI gate on both
 * the release/1.x (Node 8 floor) and feat/node-sdk (Node 18 floor) branches.
 *
 * "Network-free" doesn't mean "never actually attempts an HTTP call" — a blank title
 * only ever exercises the validation-failure path, never the transport. Port 1 on
 * loopback reliably refuses the connection immediately (nothing listens there), so a
 * fully valid request pointed at it still reaches the real transport.sendRequest call
 * and fails there — genuinely exercising that path — without depending on any real
 * network access or touching the actual Oppex service.
 */

var assert = require('assert');
var path = require('path');

process.env.OPPEX_TEST_ENDPOINT_URL = 'http://127.0.0.1:1';

var sdk = require(path.join(__dirname, '..', 'dist', 'index.js'));
var IncidentClient = sdk.IncidentClient;
var Severity = sdk.Severity;

function fail(message) {
  console.error('SMOKE_FAILED: ' + message);
  process.exit(1);
}

function main() {
  if (typeof IncidentClient !== 'function') {
    fail('IncidentClient export missing');
  }
  if (typeof Severity !== 'object' || Severity.HIGH !== 4) {
    fail('Severity export missing or wrong');
  }

  // Deliberately wrong-looking credentials — this client's requests are meant to
  // fail, since the point of check 1 below is reaching the real transport call and
  // having THAT fail, not a credentials-shaped validation error.
  var client = new IncidentClient({ apiKey: 'wrong-api-key', serviceKey: 'wrong-service-key' });

  var sawUnhandled = false;
  function onUnhandled() {
    sawUnhandled = true;
  }
  process.on('unhandledRejection', onUnhandled);

  // 1. A fully valid request — passes validation, reaches transport.sendRequest for
  // real, and fails there (connection refused) after exhausting all retries. Must
  // still resolve successful:false, never throw, same guarantee as a validation
  // failure but exercised through the actual network-call path this time.
  client
    .sendIncident({ title: 'a', source: 'x', severity: Severity.LOW })
    .then(function (res) {
      if (res.successful !== false) {
        fail('a real transport failure must resolve successful:false');
      }
      if (res.code !== -1) {
        fail('a connection failure must resolve with code -1, got: ' + res.code);
      }
      return client.close();
    })
    .then(function () {
      // Fresh client for the validation-failure checks below — the one above is
      // already closed.
      client = new IncidentClient({ apiKey: 'api-key', serviceKey: 'service-key' });

      // 2. Invalid request must resolve a failed response, never throw/reject.
      return client.sendIncident({ title: '', source: 'x', severity: Severity.LOW });
    })
    .then(function (res) {
      if (res.successful !== false) {
        fail('blank title must resolve successful:false');
      }
      // 3. sendIncidentAsync with an invalid request must not throw synchronously and
      // must not produce an unhandled rejection.
      var sawOnError = false;
      client.sendIncidentAsync(
        { title: '', source: 'x', severity: Severity.LOW },
        {
          onError: function () {
            sawOnError = true;
          },
        },
      );

      return client.close().then(function () {
        if (!sawOnError) {
          fail('sendIncidentAsync onError callback did not fire for an invalid request');
        }

        // 4. Calling sendIncident after close() must resolve failed, never throw.
        return client.sendIncident({ title: 'a', source: 'b', severity: Severity.LOW });
      });
    })
    .then(function (res) {
      if (res.successful !== false) {
        fail('post-close sendIncident must resolve successful:false');
      }

      // 5. close() must be idempotent.
      return client.close();
    })
    .then(function () {
      setTimeout(function () {
        process.removeListener('unhandledRejection', onUnhandled);
        if (sawUnhandled) {
          fail('an unhandled rejection occurred during the smoke test');
        }
        console.log('SMOKE_OK node=' + process.version);
      }, 50);
    })
    .catch(function (err) {
      fail('smoke test itself threw: ' + (err && err.message ? err.message : String(err)));
    });
}

main();
