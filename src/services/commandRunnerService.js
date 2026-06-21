const { spawn } = require('child_process');

function appendLimited(current, chunk, maxChars) {
    if (current.length >= maxChars) return current;
    return (current + chunk.toString()).slice(0, maxChars);
}

function runCommand(
    command,
    args = [],
    {
        inputBuffer = null,
        timeoutMs = 15000,
        maxOutputChars = 8192
    } = {}
) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let stdout = '';
        let stderr = '';
        let timer = null;

        const child = spawn(command, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true
        });

        function finish(callback, value) {
            if (settled) return;

            settled = true;

            if (timer) {
                clearTimeout(timer);
            }

            callback(value);
        }

        timer = setTimeout(() => {
            child.kill('SIGKILL');

            const error = new Error(
                `Command timed out after ${timeoutMs}ms: ${command}`
            );

            error.code = 'COMMAND_TIMEOUT';

            finish(reject, error);
        }, Math.max(1000, Number(timeoutMs) || 15000));

        child.stdout.on('data', (chunk) => {
            stdout = appendLimited(stdout, chunk, maxOutputChars);
        });

        child.stderr.on('data', (chunk) => {
            stderr = appendLimited(stderr, chunk, maxOutputChars);
        });

        child.on('error', (error) => {
            const wrapped = new Error(
                `Unable to start ${command}: ${error.message}`
            );

            wrapped.code = error.code || 'COMMAND_START_FAILED';

            finish(reject, wrapped);
        });

        child.on('close', (code, signal) => {
            finish(resolve, {
                code,
                signal,
                stdout: stdout.trim(),
                stderr: stderr.trim()
            });
        });

        child.stdin.on('error', (error) => {
            if (error.code !== 'EPIPE') {
                finish(reject, error);
            }
        });

        if (inputBuffer) {
            child.stdin.end(inputBuffer);
        } else {
            child.stdin.end();
        }
    });
}

module.exports = {
    runCommand
};