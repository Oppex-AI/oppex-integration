'use strict';

/*
 * Isolated external consumer for the Node.js SDK, mirroring
 * .github/smoke/java/ExternalConsumer.java: uses only the published package's public
 * surface, not a relative path into this repo, network-free, and prints a fixed
 * sentinel the CI workflow greps for. The workflow installs the packed tarball into a
 * fresh throwaway project via npm, then pnpm, then yarn, and runs this same script
 * against each installation — this is what catches pnpm/yarn's stricter
 * phantom-dependency resolution that npm's flat node_modules silently tolerates.
 *
 * The SDK is published as two separate npm packages, not one package with two major
 * version lines — @oppex/integration-sdk (modern, fetch, Node >=18) and
 * @oppex/integration-sdk-legacy (legacy, http/https, Node >=8) — so which one to
 * require is passed in via SDK_PACKAGE_NAME rather than hardcoded, letting this one
 * file cover both instead of needing a second, near-duplicate consumer script.
 *
 * "Network-free" doesn't mean "never actually attempts an HTTP call" — a blank title
 * only ever exercises the validation-failure path, never the transport. Port 1 on
 * loopback reliably refuses the connection immediately (nothing listens there), so a
 * fully valid request pointed at it still reaches the real transport.sendRequest call
 * and fails there, genuinely exercising that path without depending on real network
 * access or touching the actual Oppex service.
 */

var assert = require('assert');
var packageName = process.env.SDK_PACKAGE_NAME || '@oppex/integration-sdk';

process.env.OPPEX_TEST_ENDPOINT_URL = 'http://127.0.0.1:1';

var sdk = require(packageName);

function main() {
  var IncidentClient = sdk.IncidentClient;
  var Severity = sdk.Severity;

  assert.strictEqual(typeof IncidentClient, 'function', 'IncidentClient export missing');
  assert.strictEqual(Severity.MEDIUM, 3, 'unexpected severity mapping');

  // Deliberately wrong-looking credentials — the point of this first check is
  // reaching the real transport call and having THAT fail (connection refused), not a
  // credentials-shaped validation error.
  var badClient = new IncidentClient({ apiKey: 'wrong-api-key', serviceKey: 'wrong-service-key' });

  return badClient
    .sendIncident({ title: 'valid title', source: 'github-actions', severity: Severity.MEDIUM })
    .then(function (response) {
      assert.strictEqual(response.successful, false, 'a real transport failure must resolve failed, not throw');
      assert.strictEqual(response.code, -1, 'a connection failure must resolve with code -1');
      return badClient.close();
    })
    .then(function () {
      var client = new IncidentClient({
        apiKey: 'external-consumer-api-key',
        serviceKey: 'external-consumer-service-key',
      });

      // Invalid request (blank title) resolves via validation before any HTTP
      // attempt, exercising the "never throws" contract from that side too.
      return client
        .sendIncident({ title: '', source: 'github-actions', severity: Severity.MEDIUM })
        .then(function (response) {
          assert.strictEqual(response.successful, false, 'invalid request must resolve failed, not throw');
          return client.close();
        });
    })
    .then(function () {
      console.log('EXTERNAL_CONSUMER_OK node=' + process.version);
    });
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
