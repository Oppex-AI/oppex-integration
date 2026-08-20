'use strict';

/*
 * Isolated external consumer for the Node.js SDK, mirroring
 * .github/smoke/java/ExternalConsumer.java: uses only the published package's public
 * surface (require('@oppex/integration-sdk'), not a relative path into this repo),
 * network-free, and prints a fixed sentinel the CI workflow greps for. The workflow
 * installs the packed tarball into a fresh throwaway project via npm, then pnpm, then
 * yarn, and runs this same script against each installation — this is what catches
 * pnpm/yarn's stricter phantom-dependency resolution that npm's flat node_modules
 * silently tolerates.
 */

var assert = require('assert');
var sdk = require('@oppex/integration-sdk');

function main() {
  var IncidentClient = sdk.IncidentClient;
  var Severity = sdk.Severity;

  assert.strictEqual(typeof IncidentClient, 'function', 'IncidentClient export missing');
  assert.strictEqual(Severity.MEDIUM, 3, 'unexpected severity mapping');

  var client = new IncidentClient({
    apiKey: 'external-consumer-api-key',
    serviceKey: 'external-consumer-service-key',
    tenant: 'external-consumer-tenant',
  });

  // Network-free, like the Java consumer: an invalid request (blank title) resolves via
  // validation before any HTTP attempt, so this never reaches the real Oppex service —
  // and it exercises the "never throws" contract as the smoke assertion itself.
  return client
    .sendIncident({ title: '', source: 'github-actions', severity: Severity.MEDIUM })
    .then(function (response) {
      assert.strictEqual(response.successful, false, 'invalid request must resolve failed, not throw');
      return client.close();
    })
    .then(function () {
      console.log('EXTERNAL_CONSUMER_OK node=' + process.version);
    });
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
