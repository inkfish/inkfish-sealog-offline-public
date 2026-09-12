export default {
  test: {
    environment: 'happy-dom',
    include: ['tests/dom/**/*.test.mjs'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage/dom'
    }
  }
};
