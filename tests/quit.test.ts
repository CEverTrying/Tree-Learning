import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const createQuitController = require("../desktop/quit.cjs");

function setup(flush: () => Promise<void>, discard = false, closeFails = false) {
  const calls = { prevented: 0, prompts: 0, closed: 0, quit: 0, errors: 0 };
  const controller = createQuitController({
    flush,
    close: async () => { calls.closed++; if (closeFails) throw new Error("close failed"); },
    confirmDiscard: async () => { calls.prompts++; return discard; },
    quit: () => { calls.quit++; },
    onError: () => { calls.errors++; },
  });
  const request = () => controller.request({ preventDefault() { calls.prevented++; } });
  return { calls, controller, request };
}
const fail = async () => { throw new Error("save failed"); };

test("successful save exits without prompting and permits the final quit event", async () => {
  const f = setup(async () => {});
  await f.request();
  assert.equal(f.controller.ready, true);
  await f.request();
  assert.deepEqual(f.calls, { prevented: 1, prompts: 0, closed: 1, quit: 1, errors: 0 });
});

test("cancel preserves the window and service, then permits a later save retry", async () => {
  let failing = true;
  const f = setup(async () => { if (failing) await fail(); });
  await f.request();
  assert.equal(f.controller.ready, false);
  assert.equal(f.calls.closed, 0);
  assert.equal(f.calls.quit, 0);
  assert.equal(f.calls.prompts, 1);
  failing = false;
  await f.request();
  assert.equal(f.calls.quit, 1);
});

test("discard exits after a failed save even if service cleanup fails", async () => {
  const f = setup(fail, true, true);
  await f.request();
  assert.equal(f.calls.prompts, 1);
  assert.equal(f.calls.closed, 1);
  assert.equal(f.calls.quit, 1);
  assert.equal(f.controller.ready, true);
});

test("repeated exit requests cannot bypass an in-progress save or duplicate the prompt", async () => {
  let reject!: (error: Error) => void;
  const f = setup(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
  const pending = f.request();
  await f.request();
  assert.equal(f.controller.ready, false);
  assert.equal(f.calls.quit, 0);
  reject(new Error("save failed"));
  await pending;
  assert.equal(f.calls.prompts, 1);
  assert.equal(f.calls.quit, 0);
});
