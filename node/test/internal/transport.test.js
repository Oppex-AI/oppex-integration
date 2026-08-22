'use strict';

var assert = require('assert');
var path = require('path');
var http = require('http');

var transport = require(path.join(__dirname, '..', '..', 'dist', 'internal', 'transport.js'));
var sendRequest = transport.createTransport().sendRequest;

function startServer(handler) {
  return new Promise(function (resolve) {
    var server = http.createServer(handler);
    server.listen(0, '127.0.0.1', function () {
      resolve(server);
    });
  });
}

function urlOf(server) {
  var address = server.address();
  return 'http://127.0.0.1:' + address.port;
}

async function main() {
  // Successful round trip: status + body pass through unchanged.
  var server1 = await startServer(function (req, res) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, code: 200 }));
  });
  var res1 = await sendRequest(urlOf(server1), JSON.stringify({ x: 1 }), { 'Content-Type': 'application/json' });
  assert.strictEqual(res1.statusCode, 200);
  assert.ok(res1.body.indexOf('"success":true') !== -1);
  server1.close();

  // Non-2xx status is returned as-is, not thrown.
  var server2 = await startServer(function (req, res) {
    res.writeHead(502, { 'Content-Type': 'text/html' });
    res.end('<html>Bad Gateway</html>');
  });
  var res2 = await sendRequest(urlOf(server2), '{}', {});
  assert.strictEqual(res2.statusCode, 502);
  assert.ok(res2.body.indexOf('Bad Gateway') !== -1);
  server2.close();

  // Connection failure (nothing listening) rejects — this is the transport-level
  // network error IncidentClient.deliver() catches and classifies as retryable.
  var rejected = false;
  try {
    await sendRequest('http://127.0.0.1:1', '{}', {});
  } catch (err) {
    rejected = true;
  }
  assert.ok(rejected, 'a connection failure must reject, for the caller to classify');

  // Isolation: closing one transport instance must never affect a different instance's
  // ability to make requests — this is the exact scenario the shared-agent-pool bug
  // (module-level singletons) would have broken.
  var server3 = await startServer(function (req, res) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, code: 200 }));
  });
  var transportA = transport.createTransport();
  var transportB = transport.createTransport();
  transportA.closeTransport();
  var res3 = await transportB.sendRequest(urlOf(server3), '{}', {});
  assert.strictEqual(res3.statusCode, 200, "closing transportA must not break transportB's requests");
  transportB.closeTransport();
  server3.close();

  console.log('transport.test.js OK');
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
