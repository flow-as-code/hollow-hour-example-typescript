/*
 * Copyright 2026 The flow-as-code Authors
 * SPDX-License-Identifier: Apache-2.0
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "lambdas/**/*.test.ts"],
    exclude: ["**/node_modules/**", "build/**"],
    // A ceiling for hangs, not a latency budget: the generator and emit tests
    // build real FlowDoc sets, which is slow on a cold two-core CI runner.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
