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

  console.log('asyncDispatcher.test.js OK');
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
