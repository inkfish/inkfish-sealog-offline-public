import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '../..');
const project = `sealog-smoke-${process.pid}-${Date.now()}`;
const temporary = await mkdtemp(join(tmpdir(), 'sealog-docker-'));
const envFile = join(temporary, 'empty.env');
await writeFile(envFile, '');
const env = { ...process.env, SEALOG_DEV_PORT: '0' };
const composeArgs = ['compose', '--project-name', project, '--env-file', envFile, '--file', join(root, 'docker-compose.yml')];
const servers = [];
let imageContainer;

async function output(command, args) {
  const result = await exec(command, args, { cwd: root, env, maxBuffer: 4 * 1024 * 1024 });
  return result.stdout.trim();
}

async function run(command, args, extraEnv = {}) {
  await new Promise((done, reject) => {
    const child = spawn(command, args, { cwd: root, env: { ...env, ...extraEnv }, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? done() : reject(new Error(`${command} exited ${signal || code}`)));
  });
}

async function testDeployment(mode, binding) {
  const port = binding.match(/:(\d+)$/)?.[1];
  if (!port) throw new Error(`Could not resolve the ${mode} container port: ${binding}`);
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (true) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      await response.arrayBuffer();
      if (response.ok) break;
    } catch {
      // The image entrypoint may still be preparing nginx.
    }
    if (Date.now() > deadline) throw new Error(`The ${mode} container did not become ready at ${url}`);
    await delay(100);
  }
  await run(process.execPath, [join(root, 'node_modules/@playwright/test/cli.js'), 'test', '--config', 'playwright.docker.config.mjs'], {
    SEALOG_DOCKER_MODE: mode,
    SEALOG_DOCKER_URL: url
  });
}

try {
  // Real host listeners exercise host.docker.internal on Desktop and Linux.
  // They contain only mock data, and close when the isolated test project ends.
  for (const [deployment, port] of [['a', 8000], ['b', 8100], ['c', 8200]]) {
    const server = createServer(async (request, response) => {
      if (!request.url.startsWith('/sealog-server/docker-probe')) {
        response.writeHead(404);
        response.end('No mock API for this path');
        return;
      }
      let body = '';
      for await (const chunk of request) body += chunk;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        deployment,
        method: request.method,
        path: request.url,
        host: request.headers.host,
        forwardedProto: request.headers['x-forwarded-proto'],
        body
      }));
    });
    servers.push(server);
    await new Promise((done, reject) => {
      server.once('error', (error) => reject(new Error(`Docker smoke tests need free host port ${port}: ${error.message}`)));
      server.listen(port, '0.0.0.0', done);
    });
  }

  await run('docker', [...composeArgs, 'config', '--quiet']);
  await run('docker', [...composeArgs, 'up', '--build', '--detach']);
  await run('docker', [...composeArgs, 'exec', '-T', 'sealog-offline', 'nginx', '-t']);
  const composeBinding = await output('docker', [...composeArgs, 'port', 'sealog-offline', '80']);
  await testDeployment('compose', composeBinding);

  // Test the built bundle separately: Compose mounts could mask missing COPYs.
  const image = await output('docker', [...composeArgs, 'images', '--quiet', 'sealog-offline']);
  imageContainer = await output('docker', ['run', '--detach', '--rm', '--publish', '127.0.0.1::80', '--add-host', 'host.docker.internal:host-gateway', image]);
  await run('docker', ['exec', imageContainer, 'nginx', '-t']);
  await testDeployment('image', await output('docker', ['port', imageContainer, '80/tcp']));
} catch (error) {
  process.exitCode = 1;
  console.error(error.message);
  await run('docker', [...composeArgs, 'logs', '--no-color']).catch(() => {});
} finally {
  if (imageContainer) await run('docker', ['stop', imageContainer]).catch(() => {});
  await run('docker', [...composeArgs, 'down', '--rmi', 'local', '--volumes', '--remove-orphans']).catch(() => { process.exitCode = 1; });
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
  await rm(temporary, { recursive: true, force: true });
}
