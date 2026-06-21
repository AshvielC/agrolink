const test = require('node:test');
const assert = require('node:assert/strict');
const { Writable } = require('node:stream');

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/agrolink-test';
process.env.LOG_LEVEL = 'debug';

function captureStream(stream, task) {
  const originalWrite = stream.write;
  let output = '';

  stream.write = function write(chunk, ...args) {
    output += String(chunk);
    return true;
  };

  try {
    task();
  } finally {
    stream.write = originalWrite;
  }

  return output;
}

const monitoring = require('../../src/services/operationalMonitoringService');

test.beforeEach(() => {
  monitoring.resetOperationalMonitoringForTests();
});

test('immediate scanner queue overflow emits a structured alert', () => {
  const output = captureStream(process.stderr, () => {
    monitoring.recordScannerQueueOverflow({ queuedScans: 10 });
  });

  assert.match(output, /"event":"monitor.alert.triggered"/);
  assert.match(output, /"alertType":"upload_scanner.queue_overflow"/);
});

test('MongoDB disconnect emits a structured alert', () => {
  const output = captureStream(process.stderr, () => {
    monitoring.recordMongoDisconnected();
  });

  assert.match(output, /"alertType":"database.disconnected"/);
});

test('SMTP failure emits a structured alert', () => {
  const output = captureStream(process.stderr, () => {
    monitoring.recordSmtpFailure(new Error('SMTP unavailable'));
  });

  assert.match(output, /"alertType":"smtp.failure"/);
});
