/**
 * Container runtime abstraction for NanoClaw.
 * All runtime-specific logic lives here so swapping runtimes means changing one file.
 *
 * Supports two runtimes:
 *   - apple-container: Apple Container CLI (`container`) — macOS native
 *   - docker: Docker CLI (`docker`) — cross-platform
 *
 * Configured via CONTAINER_RUNTIME in .env or auto-detected.
 */
import { execSync } from 'child_process';

import { CONTAINER_RUNTIME } from './config.js';
import { logger } from './logger.js';

/** Returns the container runtime binary name, derived from config. */
export function runtimeBin(): string {
  return CONTAINER_RUNTIME === 'apple-container' ? 'container' : 'docker';
}

/** The container runtime binary name (alias for backward compat). */
export const CONTAINER_RUNTIME_BIN = runtimeBin();

/** Returns CLI args for a readonly bind mount. */
export function readonlyMountArgs(
  hostPath: string,
  containerPath: string,
): string[] {
  return [
    '--mount',
    `type=bind,source=${hostPath},target=${containerPath},readonly`,
  ];
}

/** Returns the shell command to stop a container by name. */
export function stopContainer(name: string): string {
  return `${runtimeBin()} stop ${name}`;
}

/** Ensure the container runtime is running, starting it if needed. */
export function ensureContainerRuntimeRunning(): void {
  if (CONTAINER_RUNTIME === 'docker') {
    // Docker daemon is managed externally (Docker Desktop, systemd, etc.)
    // Just verify it's reachable.
    try {
      execSync('docker info', { stdio: 'pipe' });
      logger.debug('Docker daemon is running');
    } catch (err) {
      logger.error({ err }, 'Docker daemon is not running');
      console.error(
        '\n╔════════════════════════════════════════════════════════════════╗',
      );
      console.error(
        '║  FATAL: Docker daemon is not running                          ║',
      );
      console.error(
        '║                                                                ║',
      );
      console.error(
        '║  Agents cannot run without Docker. To fix:                    ║',
      );
      console.error(
        '║  1. Start Docker Desktop, or                                  ║',
      );
      console.error(
        '║  2. Run: sudo systemctl start docker                          ║',
      );
      console.error(
        '║  3. Restart NanoClaw                                          ║',
      );
      console.error(
        '╚════════════════════════════════════════════════════════════════╝\n',
      );
      throw new Error('Container runtime is required but failed to start');
    }
    return;
  }

  // Apple Container path
  try {
    execSync('container system status', { stdio: 'pipe' });
    logger.debug('Container runtime already running');
  } catch {
    logger.info('Starting container runtime...');
    try {
      execSync('container system start', {
        stdio: 'pipe',
        timeout: 30000,
      });
      logger.info('Container runtime started');
    } catch (err) {
      logger.error({ err }, 'Failed to start container runtime');
      console.error(
        '\n╔════════════════════════════════════════════════════════════════╗',
      );
      console.error(
        '║  FATAL: Container runtime failed to start                      ║',
      );
      console.error(
        '║                                                                ║',
      );
      console.error(
        '║  Agents cannot run without a container runtime. To fix:        ║',
      );
      console.error(
        '║  1. Ensure Apple Container is installed                        ║',
      );
      console.error(
        '║  2. Run: container system start                                ║',
      );
      console.error(
        '║  3. Restart NanoClaw                                           ║',
      );
      console.error(
        '╚════════════════════════════════════════════════════════════════╝\n',
      );
      throw new Error('Container runtime is required but failed to start');
    }
  }
}

/** Kill orphaned NanoClaw containers from previous runs. */
export function cleanupOrphans(): void {
  try {
    if (CONTAINER_RUNTIME === 'docker') {
      // Docker: use server-side filtering for efficiency
      const output = execSync(
        `docker ps --filter name=nanoclaw- --format '{{.Names}}'`,
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          encoding: 'utf-8',
        },
      );
      const orphans = output
        .trim()
        .split('\n')
        .filter((name) => name.startsWith('nanoclaw-'));
      for (const name of orphans) {
        try {
          execSync(stopContainer(name), { stdio: 'pipe' });
        } catch {
          /* already stopped */
        }
      }
      if (orphans.length > 0) {
        logger.info(
          { count: orphans.length, names: orphans },
          'Stopped orphaned containers',
        );
      }
    } else {
      // Apple Container: parse JSON array from `container ls`
      const output = execSync('container ls --format json', {
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf-8',
      });
      const containers: { status: string; configuration: { id: string } }[] =
        JSON.parse(output || '[]');
      const orphans = containers
        .filter(
          (c) =>
            c.status === 'running' &&
            c.configuration.id.startsWith('nanoclaw-'),
        )
        .map((c) => c.configuration.id);
      for (const name of orphans) {
        try {
          execSync(stopContainer(name), { stdio: 'pipe' });
        } catch {
          /* already stopped */
        }
      }
      if (orphans.length > 0) {
        logger.info(
          { count: orphans.length, names: orphans },
          'Stopped orphaned containers',
        );
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to clean up orphaned containers');
  }
}
