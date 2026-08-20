'use strict';

/*
 * Network-free external-consumer smoke test, mirroring
 * .github/smoke/java/ExternalConsumer.java: constructs and closes a client, validates
 * exported shape and the "never throws" contract, without posting to Oppex. Written in
 * plain, conservative CommonJS (no destructuring, no arrow functions, no let/const-only
 * assumptions beyond what Node 8 supports) so it runs unmodified as the CI gate on both
 * the release/1.x (Node 8 floor) and feat/node-sdk (Node 18 floor) branches.
 */

var assert = require('assert');
var path = require('path');

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

  var client = new IncidentClient({ apiKey: 'api-key', serviceKey: 'service-key', tenant: 'tenant' });

  var sawUnhandled = false;
  function onUnhandled() {
    sawUnhandled = true;
  }
  process.on('unhandledRejection', onUnhandled);

  // 1. Invalid request must resolve a failed response, never throw/reject.
  client
    .sendIncident({ title: '', source: 'x', severity: Severity.LOW })
    .then(function (res) {
      if (res.successful !== false) {
        fail('blank title must resolve successful:false');
      }
      // 2. sendIncidentAsync with an invalid request must not throw synchronously and
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

        // 3. Calling sendIncident after close() must resolve failed, never throw.
        return client.sendIncident({ title: 'a', source: 'b', severity: Severity.LOW });
      });
    })
    .then(function (res) {
      if (res.successful !== false) {
        fail('post-close sendIncident must resolve successful:false');
      }

      // 4. close() must be idempotent.
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
