'use strict';

var assert = require('assert');
var path = require('path');

var mod = require(path.join(__dirname, '..', '..', 'dist', 'internal', 'retry', 'RetryExecutor.js'));
var executeWithRetry = mod.executeWithRetry;

function fakeSleep(delays) {
  return function (ms) {
    delays.push(ms);
    return Promise.resolve();
  };
}

async function main() {
  // Retries exactly 3 times (4 attempts total) on a retryable failure, then throws.
  var attempts = 0;
  var delays = [];
  var threw = false;
  try {
    await executeWithRetry(
      function () {
        attempts++;
        return Promise.reject({ retryable: true });
      },
      function () {
        return true;
      },
      fakeSleep(delays),
    );
  } catch (err) {
    threw = true;
  }
  assert.ok(threw, 'must throw once retries exhaust');
  assert.strictEqual(attempts, 4, 'expected 4 total attempts (1 + 3 retries)');
  assert.deepStrictEqual(delays, [500, 1000, 2000], 'delays must be exact, no jitter');

  // Non-retryable failure stops immediately, no retries.
  var attempts2 = 0;
  var threw2 = false;
  try {
    await executeWithRetry(
      function () {
        attempts2++;
        return Promise.reject({ retryable: false });
      },
      function (err) {
        return err.retryable;
      },
      fakeSleep([]),
    );
  } catch (err) {
    threw2 = true;
  }
  assert.ok(threw2);
  assert.strictEqual(attempts2, 1, 'non-retryable failure must not retry');

  // Succeeds on the 2nd attempt after one retryable failure.
  var attempts3 = 0;
  var result = await executeWithRetry(
    function () {
      attempts3++;
      if (attempts3 === 1) {
        return Promise.reject({ retryable: true });
      }
      return Promise.resolve('ok');
    },
    function () {
      return true;
    },
    fakeSleep([]),
  );
  assert.strictEqual(result, 'ok');
  assert.strictEqual(attempts3, 2);

  console.log('retryExecutor.test.js OK');
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
