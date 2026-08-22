'use strict';

var assert = require('assert');
var path = require('path');

var mod = require(path.join(__dirname, '..', '..', 'dist', 'internal', 'async', 'AsyncDispatcher.js'));
var AsyncDispatcher = mod.AsyncDispatcher;

function delay(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function main() {
  // Max concurrency respected: with maxConcurrency=1, a slow first task blocks a second
  // from starting until it finishes.
  var order = [];
  var dispatcher = new AsyncDispatcher(1, 5000);
  dispatcher.submit(function () {
    order.push('a-start');
    return delay(30).then(function () {
      order.push('a-end');
    });
  });
  dispatcher.submit(function () {
    order.push('b-start');
    return Promise.resolve();
  });
  await delay(60);
  assert.deepStrictEqual(order, ['a-start', 'a-end', 'b-start'], 'second task must wait for concurrency slot');

  // Drop-oldest-on-full: capacity 2, concurrency pinned at 0 in-flight via a permanently
  // busy slot, so submissions queue; a 4th submission must drop the oldest queued task.
  var executed = [];
  var blockResolve;
  var blocker = new Promise(function (resolve) {
    blockResolve = resolve;
  });
  var d2 = new AsyncDispatcher(1, 2);
  d2.submit(function () {
    return blocker;
  }); // occupies the single concurrency slot
  d2.submit(function () {
    executed.push('q1');
    return Promise.resolve();
  });
  d2.submit(function () {
    executed.push('q2');
    return Promise.resolve();
  });
  d2.submit(function () {
    executed.push('q3');
    return Promise.resolve();
  }); // queue capacity 2 already full with q1,q2 -> drops q1, keeps q2,q3
  blockResolve();
  await delay(30);
  assert.deepStrictEqual(executed, ['q2', 'q3'], 'oldest queued task must be dropped when full');

  // close() drains in-flight work up to the timeout.
  var closedOrder = [];
  var d3 = new AsyncDispatcher(1, 10);
  d3.submit(function () {
    return delay(20).then(function () {
      closedOrder.push('done');
    });
  });
  await d3.close(1000);
  assert.deepStrictEqual(closedOrder, ['done'], 'close() must wait for in-flight work to drain');

  // close() is idempotent.
  await d3.close(1000);

  // Sustained throughput well past capacity, with the queue kept topped up near
  // capacity (never emptying) rather than draining between tasks: the backing array is
  // only compacted once its dead (already-dequeued) prefix grows past `capacity`, and
  // that path only fires while the queue is non-empty. Each running task immediately
  // feeds in the next one, so the queue stays full and many compactions happen across
  // the run. FIFO order and exact task count must still hold — this is the regression
  // test for the shift()-free, head-index queue implementation.
  var capacity = 5;
  var totalTasks = capacity * 20;
  var seen = [];
  var nextToSubmit = 0;
  var d4 = new AsyncDispatcher(1, capacity);

  function feedOne() {
    if (nextToSubmit >= totalTasks) {
      return;
    }
    var n = nextToSubmit++;
    d4.submit(function () {
      seen.push(n);
      feedOne();
      return Promise.resolve();
    });
  }

  for (var i = 0; i < capacity; i++) {
    feedOne();
  }

  // Wait for the self-feeding cascade to fully finish submitting and running before
  // close()'ing — close() flips the dispatcher closed synchronously, which would
  // otherwise silently reject every later feedOne() re-submission made from inside an
  // already-queued task's body, well before the cascade actually reaches totalTasks.
  while (seen.length < totalTasks) {
    await delay(5);
  }

  await d4.close(2000);
  assert.deepStrictEqual(
    seen,
    Array.from({ length: totalTasks }, function (_, i) {
      return i;
    }),
    'every submitted task must run exactly once, in order, across many rounds of compaction',
  );

  console.log('asyncDispatcher.test.js OK');
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
