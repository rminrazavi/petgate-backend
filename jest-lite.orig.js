"use strict";

/**
 * jest-lite: Minimal Jest-compatible test runner for MOPET Phase 2.
 * Supports describe, test, beforeEach, afterEach, expect matchers.
 * No network, no external dependencies — pure Node.js.
 */

const fs = require("fs");
const path = require("path");

let testCount = 0;
let passCount = 0;
let failCount = 0;
const failures = [];

const expect = (value) => ({
  toBe(expected) {
    if (value !== expected) {
      throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
    }
  },
  toEqual(expected) {
    if (JSON.stringify(value) !== JSON.stringify(expected)) {
      throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
    }
  },
  toBeDefined() {
    if (value === undefined) throw new Error("Expected value to be defined");
  },
  toBeUndefined() {
    if (value !== undefined) throw new Error("Expected value to be undefined");
    return;
  },
  toThrow(msg) {
    try {
      value();
      throw new Error(`Expected function to throw`);
    } catch (e) {
      if (msg && !e.message.includes(msg)) {
        throw new Error(`Expected error message to include "${msg}", got "${e.message}"`);
      }
    }
  },
  toBeGreaterThanOrEqual(n) {
    if (!(value >= n)) throw new Error(`Expected ${value} >= ${n}`);
  },
  toContain(item) {
    if (!value.includes(item)) throw new Error(`Expected array to contain ${item}`);
  },
  not: {
    toBe(expected) {
      if (value === expected) throw new Error(`Expected NOT ${JSON.stringify(expected)}`);
    },
    toContain(item) {
      if (value.includes(item)) throw new Error(`Expected array to NOT contain ${item}`);
    },
  },
});

global.expect = expect;
global.describe = (name, fn) => {
  console.log(`\n${name}`);
  fn();
};

let currentSuite = null;
let beforeEachFn = null;
let afterEachFn = null;

global.beforeEach = (fn) => {
  beforeEachFn = fn;
};

global.afterEach = (fn) => {
  afterEachFn = fn;
};

global.test = (name, testFn) => {
  testCount++;
  const fullName = `  ✓ ${name}`;
  try {
    if (beforeEachFn) beforeEachFn();
    testFn();
    if (afterEachFn) afterEachFn();
    passCount++;
    console.log(fullName);
  } catch (error) {
    failCount++;
    console.log(`  ✗ ${name}`);
    failures.push({ test: name, error: error.message });
  }
};

function loadTests() {
  const testDir = path.join(__dirname, "tests");
  const testFiles = [];

  function walkDir(dir) {
    const files = fs.readdirSync(dir);
    files.forEach((file) => {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        walkDir(fullPath);
      } else if (file.endsWith(".test.js")) {
        testFiles.push(fullPath);
      }
    });
  }

  walkDir(testDir);
  return testFiles;
}

async function runTests() {
  console.log("jest-lite: Running tests\n");

  const testFiles = loadTests();
  
  for (const file of testFiles.sort()) {
    try {
      delete require.cache[require.resolve(file)];
      require(file);
    } catch (error) {
      console.error(`\nFailed to load ${file}:`, error.message);
      failCount++;
    }
  }

  console.log(`\n\n===============================================`);
  console.log(`Tests: ${passCount} passed, ${failCount} failed / ${testCount} total`);

  if (failures.length > 0) {
    console.log(`\nFailures:\n`);
    failures.forEach(({ test, error }) => {
      console.log(`  ${test}`);
      console.log(`    ${error}\n`);
    });
  }

  console.log(`===============================================\n`);
  process.exit(failCount > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
