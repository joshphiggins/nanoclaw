import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mutable state so vi.mock factories can reference it
const { mockExecSync, mockRuntimeRef } = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
  mockRuntimeRef: { value: 'apple-container' as 'apple-container' | 'docker' },
}));

// Mock logger
vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock child_process
vi.mock('child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

// Mock config — default to apple-container, tests can override via mockRuntimeRef
vi.mock('./config.js', () => ({
  get CONTAINER_RUNTIME() {
    return mockRuntimeRef.value;
  },
}));

import {
  runtimeBin,
  readonlyMountArgs,
  stopContainer,
  ensureContainerRuntimeRunning,
  cleanupOrphans,
} from './container-runtime.js';
import { logger } from './logger.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockRuntimeRef.value = 'apple-container';
});

// --- Pure functions ---

describe('readonlyMountArgs', () => {
  it('returns --mount flag with type=bind and readonly', () => {
    const args = readonlyMountArgs('/host/path', '/container/path');
    expect(args).toEqual([
      '--mount',
      'type=bind,source=/host/path,target=/container/path,readonly',
    ]);
  });
});

describe('stopContainer', () => {
  it('returns stop command using CONTAINER_RUNTIME_BIN', () => {
    expect(stopContainer('nanoclaw-test-123')).toBe(
      `${runtimeBin()} stop nanoclaw-test-123`,
    );
  });
});

// --- ensureContainerRuntimeRunning (Apple Container) ---

describe('ensureContainerRuntimeRunning (apple-container)', () => {
  beforeEach(() => {
    mockRuntimeRef.value = 'apple-container';
  });

  it('does nothing when runtime is already running', () => {
    mockExecSync.mockReturnValueOnce('');

    ensureContainerRuntimeRunning();

    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(mockExecSync).toHaveBeenCalledWith('container system status', {
      stdio: 'pipe',
    });
    expect(logger.debug).toHaveBeenCalledWith(
      'Container runtime already running',
    );
  });

  it('auto-starts when system status fails', () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('not running');
    });
    mockExecSync.mockReturnValueOnce('');

    ensureContainerRuntimeRunning();

    expect(mockExecSync).toHaveBeenCalledTimes(2);
    expect(mockExecSync).toHaveBeenNthCalledWith(2, 'container system start', {
      stdio: 'pipe',
      timeout: 30000,
    });
    expect(logger.info).toHaveBeenCalledWith('Container runtime started');
  });

  it('throws when both status and start fail', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('failed');
    });

    expect(() => ensureContainerRuntimeRunning()).toThrow(
      'Container runtime is required but failed to start',
    );
    expect(logger.error).toHaveBeenCalled();
  });
});

// --- ensureContainerRuntimeRunning (Docker) ---

describe('ensureContainerRuntimeRunning (docker)', () => {
  beforeEach(() => {
    mockRuntimeRef.value = 'docker';
  });

  it('succeeds when docker info works', () => {
    mockExecSync.mockReturnValueOnce('');

    ensureContainerRuntimeRunning();

    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(mockExecSync).toHaveBeenCalledWith('docker info', { stdio: 'pipe' });
    expect(logger.debug).toHaveBeenCalledWith('Docker daemon is running');
  });

  it('throws when docker info fails', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('daemon not running');
    });

    expect(() => ensureContainerRuntimeRunning()).toThrow(
      'Container runtime is required but failed to start',
    );
    expect(logger.error).toHaveBeenCalled();
  });
});

// --- cleanupOrphans (Apple Container) ---

describe('cleanupOrphans (apple-container)', () => {
  beforeEach(() => {
    mockRuntimeRef.value = 'apple-container';
  });

  it('stops orphaned nanoclaw containers from JSON output', () => {
    const lsOutput = JSON.stringify([
      { status: 'running', configuration: { id: 'nanoclaw-group1-111' } },
      { status: 'stopped', configuration: { id: 'nanoclaw-group2-222' } },
      { status: 'running', configuration: { id: 'nanoclaw-group3-333' } },
      { status: 'running', configuration: { id: 'other-container' } },
    ]);
    mockExecSync.mockReturnValueOnce(lsOutput);
    mockExecSync.mockReturnValue('');

    cleanupOrphans();

    // ls + 2 stop calls (only running nanoclaw- containers)
    expect(mockExecSync).toHaveBeenCalledTimes(3);
    expect(mockExecSync).toHaveBeenNthCalledWith(
      2,
      `${runtimeBin()} stop nanoclaw-group1-111`,
      { stdio: 'pipe' },
    );
    expect(mockExecSync).toHaveBeenNthCalledWith(
      3,
      `${runtimeBin()} stop nanoclaw-group3-333`,
      { stdio: 'pipe' },
    );
    expect(logger.info).toHaveBeenCalledWith(
      { count: 2, names: ['nanoclaw-group1-111', 'nanoclaw-group3-333'] },
      'Stopped orphaned containers',
    );
  });

  it('does nothing when no orphans exist', () => {
    mockExecSync.mockReturnValueOnce('[]');

    cleanupOrphans();

    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('warns and continues when ls fails', () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('container not available');
    });

    cleanupOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Failed to clean up orphaned containers',
    );
  });

  it('continues stopping remaining containers when one stop fails', () => {
    const lsOutput = JSON.stringify([
      { status: 'running', configuration: { id: 'nanoclaw-a-1' } },
      { status: 'running', configuration: { id: 'nanoclaw-b-2' } },
    ]);
    mockExecSync.mockReturnValueOnce(lsOutput);
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('already stopped');
    });
    mockExecSync.mockReturnValueOnce('');

    cleanupOrphans();

    expect(mockExecSync).toHaveBeenCalledTimes(3);
    expect(logger.info).toHaveBeenCalledWith(
      { count: 2, names: ['nanoclaw-a-1', 'nanoclaw-b-2'] },
      'Stopped orphaned containers',
    );
  });
});

// --- cleanupOrphans (Docker) ---

describe('cleanupOrphans (docker)', () => {
  beforeEach(() => {
    mockRuntimeRef.value = 'docker';
  });

  it('stops orphaned nanoclaw containers using docker ps filter', () => {
    mockExecSync.mockReturnValueOnce(
      'nanoclaw-group1-111\nnanoclaw-group2-222\n',
    );
    mockExecSync.mockReturnValue('');

    cleanupOrphans();

    expect(mockExecSync).toHaveBeenNthCalledWith(
      1,
      `docker ps --filter name=nanoclaw- --format '{{.Names}}'`,
      { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' },
    );
    // ps + 2 stop calls
    expect(mockExecSync).toHaveBeenCalledTimes(3);
    expect(logger.info).toHaveBeenCalledWith(
      {
        count: 2,
        names: ['nanoclaw-group1-111', 'nanoclaw-group2-222'],
      },
      'Stopped orphaned containers',
    );
  });

  it('does nothing when docker ps returns empty', () => {
    mockExecSync.mockReturnValueOnce('');

    cleanupOrphans();

    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('warns and continues when docker ps fails', () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('docker not available');
    });

    cleanupOrphans();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Failed to clean up orphaned containers',
    );
  });
});
