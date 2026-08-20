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

  // Network-level failure (code: -1) that exhausts retries gets "(after N attempts)"
  // appended to its message — matches java/sdk-http's IOException-exhaustion wording.
  var networkErr;
  try {
    await executeWithRetry(
      function () {
        return Promise.reject({ retryable: true, code: -1, message: 'ECONNREFUSED' });
      },
      function () {
        return true;
      },
      fakeSleep([]),
    );
  } catch (err) {
    networkErr = err;
  }
  assert.strictEqual(networkErr.message, 'ECONNREFUSED (after 4 attempts)');
  assert.strictEqual(networkErr.code, -1, 'other fields must survive unchanged');

  // HTTP-status failure (code !== -1) that exhausts retries is rethrown with its
  // ORIGINAL message unchanged — matches java/sdk-http's IncidentException branch,
  // which never gets attempt-count wording even after exhausting retries.
  var statusErr;
  try {
    await executeWithRetry(
      function () {
        return Promise.reject({ retryable: true, code: 503, message: 'HTTP 503' });
      },
      function () {
        return true;
      },
      fakeSleep([]),
    );
  } catch (err) {
    statusErr = err;
  }
  assert.strictEqual(statusErr.message, 'HTTP 503', 'HTTP-status exhaustion must not get attempt-count wording');

  // Immediately non-retryable failure (e.g. code 401) never enters the retry loop, so
  // it never gets attempt-count wording either, network-coded or not.
  var immediateErr;
  try {
    await executeWithRetry(
      function () {
        return Promise.reject({ retryable: false, code: 401, message: 'HTTP 401' });
      },
      function (err) {
        return err.retryable;
      },
      fakeSleep([]),
    );
  } catch (err) {
    immediateErr = err;
  }
  assert.strictEqual(immediateErr.message, 'HTTP 401');

  console.log('retryExecutor.test.js OK');
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
