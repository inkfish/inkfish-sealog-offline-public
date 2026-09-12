import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatAppVersion,
  buildSwFallbackLabel,
  buildSwDisplayLabel,
  shouldWarnVersionMismatch
} from '../../src/runtime/version-state.js';

test('formatAppVersion preserves exact cache version string', () => {
  assert.equal(formatAppVersion('v0.10.2.1'), 'v0.10.2.1');
  assert.equal(formatAppVersion(''), 'unknown');
});

test('buildSwFallbackLabel handles unsupported/inactive/active states', () => {
  assert.equal(buildSwFallbackLabel({ serviceWorkerSupported: false }), 'unsupported');
  assert.equal(buildSwFallbackLabel({ serviceWorkerSupported: true, hasController: false }), 'inactive');
  assert.equal(
    buildSwFallbackLabel({
      serviceWorkerSupported: true,
      hasController: true,
      controllerState: 'activated',
      controllerScriptUrl: 'https://host/sw.js'
    }),
    'active (awaiting version)'
  );
  assert.equal(
    buildSwFallbackLabel({
      serviceWorkerSupported: true,
      hasController: true,
      controllerState: 'installing',
      controllerScriptUrl: ''
    }),
    'installing (controller)'
  );
  assert.equal(
    buildSwFallbackLabel({
      serviceWorkerSupported: true,
      hasController: true,
      controllerState: 'waiting',
      controllerScriptUrl: '///'
    }),
    'waiting (controller)'
  );
  assert.equal(
    buildSwFallbackLabel({
      serviceWorkerSupported: true,
      hasController: true,
      controllerState: '',
      controllerScriptUrl: 'https://host/sw.js'
    }),
    'unknown (sw.js)'
  );
});

test('buildSwDisplayLabel prefers update-ready then known version', () => {
  assert.equal(
    buildSwDisplayLabel({
      knownVersion: 'v0.10.2.1',
      updateReadyVersion: 'v0.10.2.2',
      fallbackLabel: 'inactive'
    }),
    'v0.10.2.2 (update ready)'
  );
  assert.equal(
    buildSwDisplayLabel({
      knownVersion: 'v0.10.2.1',
      updateReadyVersion: null,
      fallbackLabel: 'inactive'
    }),
    'v0.10.2.1'
  );
  assert.equal(
    buildSwDisplayLabel({
      knownVersion: null,
      updateReadyVersion: null,
      fallbackLabel: ''
    }),
    'unknown'
  );
});

test('shouldWarnVersionMismatch only warns on settled mismatch', () => {
  assert.equal(
    shouldWarnVersionMismatch({
      appVersion: 'v0.10.2.1',
      swVersion: 'v0.10.2.2',
      updateReadyVersion: null
    }),
    true
  );
  assert.equal(
    shouldWarnVersionMismatch({
      appVersion: 'v0.10.2.1',
      swVersion: 'v0.10.2.2',
      updateReadyVersion: 'v0.10.2.2'
    }),
    false
  );
  assert.equal(
    shouldWarnVersionMismatch({
      appVersion: null,
      swVersion: 'v0.10.2.2',
      updateReadyVersion: null
    }),
    false
  );
});
