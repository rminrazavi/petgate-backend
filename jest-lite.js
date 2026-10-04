"use strict";

/**
 * jest-lite: Minimal test runner for MOPET unit test suites in pure Node.js.
 * Full Jest suites (with @strapi/strapi mocking) run via `pnpm test` (jest).
 */

const fs = require("fs");
const assert = require("node:assert/strict");
const path = require("path");

let testCount = 0;
let passCount = 0;
let failCount = 0;
const failures = [];
const queue = [];

function isObject(value) {
  return value !== null && typeof value === "object";
}

function matchesAsymmetric(actual, expected) {
  switch (expected.__matcher) {
    case "objectContaining":
      return subsetMatches(actual, expected.sample);
    case "arrayContaining":
      return (
        Array.isArray(actual) &&
        expected.sample.every((item) =>
          actual.some((candidate) => subsetMatches(candidate, item)),
        )
      );
    case "any":
      if (expected.constructor === String) return typeof actual === "string";
      if (expected.constructor === Number) return typeof actual === "number";
      if (expected.constructor === Boolean) return typeof actual === "boolean";
      if (expected.constructor === Function) return typeof actual === "function";
      if (expected.constructor === Object) return typeof actual === "object" && actual !== null;
      return actual instanceof expected.constructor;
    case "stringMatching":
      return (
        typeof actual === "string" &&
        (expected.pattern instanceof RegExp
          ? expected.pattern.test(actual)
          : actual.includes(expected.pattern))
      );
    default:
      return false;
  }
}

function subsetMatches(actual, sample) {
  if (actual === sample) return true;
  if (!isObject(actual) || !isObject(sample)) return false;
  for (const [key, value] of Object.entries(sample)) {
    if (value && value.__matcher) {
      if (!matchesAsymmetric(actual[key], value)) return false;
    } else if (isObject(value)) {
      if (!subsetMatches(actual[key], value)) return false;
    } else if (actual[key] !== value) {
      return false;
    }
  }
  return true;
}

function makeFn(implementation) {
  const calls = [];
  const results = [];
  let impl = implementation;

  const fn = function (...args) {
    calls.push(args);
    try {
      const value = impl ? impl.apply(this, args) : undefined;
      results.push({ type: "return", value });
      return value;
    } catch (error) {
      results.push({ type: "throw", value: error });
      throw error;
    }
  };

  fn.mock = { calls, results, instances: [] };
  fn.mockReturnValue = (val) => {
    impl = () => val;
    return fn;
  };
  fn.mockResolvedValue = (val) => {
    impl = () => Promise.resolve(val);
    return fn;
  };
  fn.mockRejectedValue = (val) => {
    impl = () => Promise.reject(val);
    return fn;
  };
  fn.mockImplementation = (newImpl) => {
    impl = newImpl;
    return fn;
  };
  fn.mockClear = () => {
    calls.length = 0;
    results.length = 0;
    return fn;
  };
  fn._isMockFunction = true;
  return fn;
}

/**
 * `jest.mock` support.
 *
 * Four suites (cart, customer-profile, otp, pet) mock `@strapi/strapi` so a
 * `createCoreService(...)` factory can be unit-tested without booting Strapi.
 * jest-lite had no `jest.mock`, so those four files threw on load and were
 * reported as "Unexecuted" — 4 real suites silently not running.
 *
 * Interception happens at `Module._load`, which is what `require` funnels
 * through, so a mock registered at the top of a test file applies to every
 * `require` below it. There is no hoisting here (jest-lite does not transform
 * source), so the same rule real Jest users follow by convention is a hard
 * requirement: call `jest.mock(...)` before requiring the module under test.
 */
const Module = require("module");
const moduleMocks = new Map();
const originalModuleLoad = Module._load;

Module._load = function patchedLoad(request, parent, isMain) {
  const mock = moduleMocks.get(request);

  if (mock) {
    if (!mock.resolved) {
      mock.value = mock.factory();

      /* A suite that only needs `createCoreService` must not break a later
         suite that requires a controller: the mock registry is global (there
         is no per-file module cache here), so both Strapi factories are
         always present. Identity factories are correct for both — the
         factory function IS what these tests exercise. */
      if (mock.value && mock.value.factories) {
        const identity = (_uid, factory) => factory;

        mock.value.factories = {
          createCoreService: identity,
          createCoreController: identity,
          createCoreRouter: () => ({ routes: [] }),
          ...mock.value.factories,
        };
      }

      mock.resolved = true;
    }

    return mock.value;
  }

  return originalModuleLoad.call(this, request, parent, isMain);
};

const jest = {
  fn: makeFn,
  mock: (request, factory) => {
    if (typeof factory !== "function") {
      throw new TypeError(
        `jest-lite: jest.mock("${request}") needs a module factory.`,
      );
    }

    moduleMocks.set(request, { factory, resolved: false });
    return jest;
  },
  unmock: (request) => {
    moduleMocks.delete(request);
    return jest;
  },
  requireActual: (request) =>
    originalModuleLoad.call(Module, request, module, false),
  resetModules: () => {
    for (const mock of moduleMocks.values()) {
      mock.resolved = false;
      mock.value = undefined;
    }

    return jest;
  },
  spyOn: (obj, method) => {
    const original = obj[method];
    const mock = makeFn(original);
    obj[method] = mock;
    mock.mockRestore = () => {
      obj[method] = original;
    };
    return mock;
  },
  clearAllMocks: () => {},
  resetAllMocks: () => {},
};

global.jest = jest;

function expect(actual) {
  const matchers = {
    toBe: (expected) => assert.strictEqual(actual, expected),
    toEqual: (expected) => {
      if (expected && expected.__matcher) {
        assert.ok(matchesAsymmetric(actual, expected));
      } else {
        assert.deepStrictEqual(actual, expected);
      }
    },
    toStrictEqual: (expected) => assert.deepStrictEqual(actual, expected),
    toBeDefined: () => assert.notStrictEqual(actual, undefined),
    toBeUndefined: () => assert.strictEqual(actual, undefined),
    toBeNull: () => assert.strictEqual(actual, null),
    toBeTruthy: () => assert.ok(actual),
    toBeFalsy: () => assert.ok(!actual),
    toBeGreaterThan: (expected) => assert.ok(actual > expected, `${actual} not > ${expected}`),
    toBeGreaterThanOrEqual: (expected) => assert.ok(actual >= expected, `${actual} not >= ${expected}`),
    toBeLessThan: (expected) => assert.ok(actual < expected, `${actual} not < ${expected}`),
    toBeLessThanOrEqual: (expected) => assert.ok(actual <= expected, `${actual} not <= ${expected}`),
    toContain: (item) => {
      if (typeof actual === "string") assert.ok(actual.includes(item));
      else if (Array.isArray(actual)) assert.ok(actual.includes(item));
      else assert.ok(item in actual);
    },
    toHaveLength: (len) => assert.strictEqual(actual.length, len),
    toMatch: (pattern) => {
      if (pattern instanceof RegExp) assert.ok(pattern.test(actual));
      else assert.ok(String(actual).includes(pattern));
    },
    toThrow: (expected) => {
      assert.throws(() => {
        if (typeof actual === "function") actual();
      }, (err) => {
        if (!expected) return true;
        if (expected instanceof RegExp) return expected.test(err.message);
        if (typeof expected === "string") return err.message.includes(expected);
        return true;
      });
    },
    toHaveBeenCalled: () => assert.ok(actual.mock.calls.length > 0),
    toHaveBeenCalledTimes: (count) => assert.strictEqual(actual.mock.calls.length, count),
    toHaveBeenCalledWith: (...args) => {
      const match = actual.mock.calls.some((call) => {
        if (call.length !== args.length) return false;
        return call.every((arg, idx) => {
          const exp = args[idx];
          if (exp && exp.__matcher) return matchesAsymmetric(arg, exp);
          if (isObject(exp) && isObject(arg)) return subsetMatches(arg, exp);
          return arg === exp;
        });
      });
      assert.ok(match, `No call matched ${JSON.stringify(args)}`);
    },
    toMatchObject: (expected) => assert.ok(subsetMatches(actual, expected)),
  };

  const not = {};
  for (const [name, fn] of Object.entries(matchers)) {
    not[name] = (...args) => {
      assert.throws(() => fn(...args));
    };
  }

  const rejects = {
    toThrow: async (expected) => {
      let threw = false;
      try {
        await actual;
      } catch (e) {
        threw = true;
        if (expected instanceof RegExp) assert.ok(expected.test(e.message));
        else if (typeof expected === "string") assert.ok(e.message.includes(expected));
      }
      assert.ok(threw, "Promise did not reject");
    },
    toEqual: async (expected) => {
      let rejectedVal;
      try {
        await actual;
        assert.fail("Promise resolved");
      } catch (e) {
        rejectedVal = e;
      }
      assert.deepStrictEqual(rejectedVal, expected);
    },
  };

  const resolves = {
    toEqual: async (expected) => {
      const val = await actual;
      assert.deepStrictEqual(val, expected);
    },
    toBe: async (expected) => {
      const val = await actual;
      assert.strictEqual(val, expected);
    },
  };

  return { ...matchers, not, rejects, resolves };
}

expect.objectContaining = (sample) => ({ __matcher: "objectContaining", sample });
expect.arrayContaining = (sample) => ({ __matcher: "arrayContaining", sample });
expect.any = (constructor) => ({ __matcher: "any", constructor });
expect.stringMatching = (pattern) => ({ __matcher: "stringMatching", pattern });

global.expect = expect;

let currentSuite = "";
let suiteBeforeHooks = [];
let suiteAfterHooks = [];

global.describe = (name, fn) => {
  const prevSuite = currentSuite;
  currentSuite = prevSuite ? `${prevSuite} > ${name}` : name;
  const prevBefore = [...suiteBeforeHooks];
  const prevAfter = [...suiteAfterHooks];
  try {
    fn();
  } finally {
    currentSuite = prevSuite;
    suiteBeforeHooks = prevBefore;
    suiteAfterHooks = prevAfter;
  }
};

global.beforeEach = (fn) => suiteBeforeHooks.push(fn);
global.afterEach = (fn) => suiteAfterHooks.push(fn);

function test(name, fn) {
  const fullName = currentSuite ? `${currentSuite} > ${name}` : name;
  const befores = [...suiteBeforeHooks];
  const afters = [...suiteAfterHooks];
  queue.push({ name: fullName, fn, befores, afters });
}

test.each = (cases) => (name, fn) => {
  for (const item of cases) {
    const rawArgs = Array.isArray(item) ? [...item] : [item];
    let argIdx = 0;
    const formatted = name.replace(/%[sifdjo]|%p/g, () => {
      const val = rawArgs[argIdx++];
      return val !== undefined ? String(val) : "";
    });
    const passArgs = Array.isArray(item) ? item : [item];
    test(formatted, () => fn(...passArgs));
  }
};

global.test = test;
global.it = test;

// Auto-discover test files
const testsDir = path.join(__dirname, "tests");
function discoverTests(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      discoverTests(full);
    } else if (entry.name.endsWith(".test.js")) {
      try {
        require(full);
      } catch (err) {
        failures.push({ name: `load ${entry.name}`, error: err });
      }
    }
  }
}

if (fs.existsSync(testsDir)) {
  discoverTests(testsDir);
}

// Execute test queue sequentially
async function run() {
  console.log(`\nStarting MOPET Test Suite (${queue.length} tests queued)...\n`);

  for (const item of queue) {
    testCount++;
    try {
      for (const b of item.befores) await b();
      await item.fn();
      for (const a of item.afters) await a();
      passCount++;
      console.log(`  ✓ ${item.name}`);
    } catch (err) {
      failCount++;
      failures.push({ name: item.name, error: err });
      console.log(`  ✗ ${item.name}`);
    }
  }

  console.log("\n===============================================");
  console.log(`Tests: ${passCount} passed, ${failCount} failed / ${testCount} total`);
  
  if (failures.length > 0) {
    console.log(`\nUnexecuted/Failed files (${failures.length}):\n`);
    for (const f of failures) {
      console.log(`  ${f.name}`);
      console.log(`    ${f.error.message || f.error}\n`);
    }
  }
  console.log("===============================================\n");
}

run();
