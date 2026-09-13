import {describe, it, expect} from 'vitest';
import {
  MAX_PATH_LENGTH,
  isEntryName,
  joinPath,
  normalizeBrowsePath,
  parentPath,
  pathCrumbs,
  printableName,
} from './paths';

describe('normalizeBrowsePath', () => {
  it('keeps an ordinary absolute path as it is', () => {
    expect(normalizeBrowsePath('/www/wwwroot/example.com')).toBe('/www/wwwroot/example.com');
    expect(normalizeBrowsePath('/')).toBe('/');
  });

  it('gives one directory one address', () => {
    expect(normalizeBrowsePath('/www//wwwroot/')).toBe('/www/wwwroot');
    expect(normalizeBrowsePath('/www/./wwwroot')).toBe('/www/wwwroot');
    expect(normalizeBrowsePath('///')).toBe('/');
  });

  it('keeps names that merely contain dots', () => {
    expect(normalizeBrowsePath('/www/wwwroot/.well-known/..hidden')).toBe(
      '/www/wwwroot/.well-known/..hidden',
    );
  });

  it('refuses to climb, rather than resolving the climb', () => {
    expect(normalizeBrowsePath('/www/wwwroot/../../etc')).toBeNull();
    expect(normalizeBrowsePath('/..')).toBeNull();
  });

  it('refuses a relative path', () => {
    expect(normalizeBrowsePath('www/wwwroot')).toBeNull();
    expect(normalizeBrowsePath('')).toBeNull();
  });

  it('refuses control characters, which would reach the panel log', () => {
    expect(normalizeBrowsePath('/www/wwwroot\n/forged')).toBeNull();
    expect(normalizeBrowsePath('/www/\u0000')).toBeNull();
    expect(normalizeBrowsePath('/www/\u007f')).toBeNull();
  });

  it('refuses a path longer than Linux allows', () => {
    expect(normalizeBrowsePath(`/${'a'.repeat(MAX_PATH_LENGTH)}`)).toBeNull();
    expect(normalizeBrowsePath(`/${'a'.repeat(MAX_PATH_LENGTH - 1)}`)).not.toBeNull();
  });

  it('refuses whatever is not a string — the nearest caller is a public endpoint', () => {
    expect(normalizeBrowsePath(undefined)).toBeNull();
    expect(normalizeBrowsePath(['/www'])).toBeNull();
    expect(normalizeBrowsePath({path: '/www'})).toBeNull();
  });
});

describe('isEntryName and joinPath', () => {
  it('joins under the root and under a directory', () => {
    expect(joinPath('/', 'www')).toBe('/www');
    expect(joinPath('/www', 'wwwroot')).toBe('/www/wwwroot');
    expect(joinPath('/www', '.env')).toBe('/www/.env');
  });

  it('will not build a path that points somewhere other than the row', () => {
    for (const name of ['', '.', '..', 'a/b', '/etc', 'line\nbreak']) {
      expect(isEntryName(name)).toBe(false);
      expect(joinPath('/www', name)).toBeNull();
    }
  });

  it('will not build a path past the length limit', () => {
    const deep = `/${'d'.repeat(MAX_PATH_LENGTH - 2)}`;
    expect(joinPath(deep, 'xyz')).toBeNull();
  });
});

describe('parentPath', () => {
  it('walks up one level and stops at the root', () => {
    expect(parentPath('/www/wwwroot')).toBe('/www');
    expect(parentPath('/www')).toBe('/');
    expect(parentPath('/')).toBeNull();
  });
});

describe('pathCrumbs', () => {
  it('lists every step from the root', () => {
    expect(pathCrumbs('/www/wwwroot')).toEqual([
      {name: '/', path: '/'},
      {name: 'www', path: '/www'},
      {name: 'wwwroot', path: '/www/wwwroot'},
    ]);
    expect(pathCrumbs('/')).toEqual([{name: '/', path: '/'}]);
  });
});

describe('printableName', () => {
  it('makes a hidden newline visible instead of letting two names look alike', () => {
    expect(printableName('index.php\n')).toBe('index.php\\x0a');
    expect(printableName('\u001b[31mred')).toBe('\\x1b[31mred');
    expect(printableName('обычное имя.txt')).toBe('обычное имя.txt');
  });
});
