import {describe, expect, test} from '@jest/globals';

// Since the filtering function is not exported, we'll need to test it indirectly
// or extract it to a separate module. For now, let's copy the function for testing.

/**
 * Filter out informational messages from stderr that are not actual errors
 * @param stderr The stderr output from helmfile
 * @returns Filtered stderr containing only actual error messages
 */
function filterInformationalMessages(stderr: string): string {
  if (!stderr) {
    return '';
  }

  const lines = stderr.split('\n');
  const filteredLines = lines.filter(line => {
    const trimmedLine = line.trim();
    
    // Filter out informational messages that are not errors
    if (trimmedLine.startsWith('Building dependency')) {
      return false;
    }
    
    // Keep the line if it doesn't match any informational patterns
    return true;
  });

  return filteredLines.join('\n').trim();
}

describe('filterInformationalMessages', () => {
  test('should return empty string for empty input', () => {
    expect(filterInformationalMessages('')).toBe('');
  });

  test('should filter out "Building dependency" messages', () => {
    const stderr = 'Building dependency release=secret-creator, chart=secret-creator\nSome other line';
    const expected = 'Some other line';
    expect(filterInformationalMessages(stderr)).toBe(expected);
  });

  test('should keep actual error messages', () => {
    const stderr = 'Error: chart not found\nBuilding dependency release=test, chart=test\nFatal: connection failed';
    const expected = 'Error: chart not found\nFatal: connection failed';
    expect(filterInformationalMessages(stderr)).toBe(expected);
  });

  test('should handle mixed informational and error messages', () => {
    const stderr = `Building dependency release=app1, chart=app1
Error: failed to render template
Building dependency release=app2, chart=app2
Warning: deprecated API version`;
    const expected = 'Error: failed to render template\nWarning: deprecated API version';
    expect(filterInformationalMessages(stderr)).toBe(expected);
  });

  test('should handle only informational messages', () => {
    const stderr = `Building dependency release=app1, chart=app1
Building dependency release=app2, chart=app2`;
    expect(filterInformationalMessages(stderr)).toBe('');
  });

  test('should preserve whitespace in non-filtered lines', () => {
    const stderr = '  Error: something failed  \nBuilding dependency release=test, chart=test\n  Warning: deprecated  ';
    const expected = 'Error: something failed  \n  Warning: deprecated';
    expect(filterInformationalMessages(stderr)).toBe(expected);
  });

  test('should handle different variations of Building dependency messages', () => {
    const stderr = `Building dependency release=my-app, chart=my-chart
Building dependency release=another-app, chart=./charts/another
Some real error message`;
    const expected = 'Some real error message';
    expect(filterInformationalMessages(stderr)).toBe(expected);
  });
});