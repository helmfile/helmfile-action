import {parseArgs} from '../src/helpers';

describe('parseArgs', () => {
  test('parses simple arguments', () => {
    expect(parseArgs('diff --detailed-exitcode')).toEqual([
      'diff',
      '--detailed-exitcode'
    ]);
  });

  test('parses arguments with single quotes', () => {
    expect(parseArgs("diff --selector 'app=test'")).toEqual([
      'diff',
      '--selector',
      'app=test'
    ]);
  });

  test('parses arguments with double quotes', () => {
    expect(parseArgs('diff --selector "app=test"')).toEqual([
      'diff',
      '--selector',
      'app=test'
    ]);
  });

  test('parses complex arguments with special characters', () => {
    expect(parseArgs('diff --values "key=value; more info"')).toEqual([
      'diff',
      '--values',
      'key=value; more info'
    ]);
  });

  test('handles empty string', () => {
    expect(parseArgs('')).toEqual([]);
  });

  test('handles whitespace only', () => {
    expect(parseArgs('   ')).toEqual([]);
  });

  test('handles escaped quotes', () => {
    expect(parseArgs('diff --values "escaped\\"quote"')).toEqual([
      'diff',
      '--values',
      'escaped"quote'
    ]);
  });

  test('handles multiple spaces', () => {
    expect(parseArgs('diff    --detailed-exitcode')).toEqual([
      'diff',
      '--detailed-exitcode'
    ]);
  });

  test('handles mixed quotes and spaces', () => {
    expect(
      parseArgs('apply --environment "production test" --skip-deps')
    ).toEqual(['apply', '--environment', 'production test', '--skip-deps']);
  });

  test('safely handles shell command injection attempts', () => {
    // This test verifies that semicolons and other shell special characters
    // don't get interpreted as command separators when in quoted arguments
    expect(
      parseArgs(
        'diff --values "description: Kind of the referent; More info: https://example.com"'
      )
    ).toEqual([
      'diff',
      '--values',
      'description: Kind of the referent; More info: https://example.com'
    ]);
  });

  test('handles shell metacharacters safely', () => {
    // Test various shell metacharacters that should be treated as literal text
    expect(
      parseArgs('apply --set "value=test; echo vulnerable" --debug')
    ).toEqual(['apply', '--set', 'value=test; echo vulnerable', '--debug']);
  });

  test('handles pipes and redirections safely', () => {
    expect(parseArgs('diff --values "config | grep test > /tmp/file"')).toEqual(
      ['diff', '--values', 'config | grep test > /tmp/file']
    );
  });
});
