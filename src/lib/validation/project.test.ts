import {describe, it, expect} from 'vitest';
import {projectModifySchema, projectCreateSchema, projectDeleteSchema} from './project';

describe('projectModifySchema', () => {
  const base = {
    cwd: '/www/node-projects/myapp/',
    name: 'myapp',
    script: 'prod:start',
    port: '3003',
    runUser: 'www',
    nodejsVersion: 'v24.13.0',
    note: 'myapp 3003',
    powerOn: 'true',
  };

  it('parses a valid input, coercing port and the flag', () => {
    const parsed = projectModifySchema.parse(base);
    expect(parsed.port).toBe(3003);
    expect(parsed.powerOn).toBe(true);
    expect(parsed.script).toBe('prod:start');
  });

  it('defaults powerOn to false when missing', () => {
    const {powerOn: _omit, ...rest} = base;
    void _omit;
    expect(projectModifySchema.parse(rest).powerOn).toBe(false);
  });

  it('rejects a non-absolute cwd', () => {
    expect(projectModifySchema.safeParse({...base, cwd: 'relative/path'}).success).toBe(false);
  });

  it('rejects an out-of-range port', () => {
    expect(projectModifySchema.safeParse({...base, port: '70000'}).success).toBe(false);
    expect(projectModifySchema.safeParse({...base, port: '0'}).success).toBe(false);
  });

  it('rejects an invalid project name', () => {
    expect(projectModifySchema.safeParse({...base, name: 'bad name!'}).success).toBe(false);
  });
});

describe('projectCreateSchema', () => {
  const base = {
    cwd: '/www/node-projects/myapp',
    name: 'myapp',
    script: 'release',
    port: '3001',
    runUser: 'www',
    nodejsVersion: 'v24.13.0',
    note: 'myapp',
    domains: 'myapp.example.com:80, second.example.com:80',
    bindExtranet: 'true',
    powerOn: 'false',
    maxMemoryLimit: '4096',
    env: '',
  };

  it('splits the domains string into a trimmed array', () => {
    const parsed = projectCreateSchema.parse(base);
    expect(parsed.domains).toEqual(['myapp.example.com:80', 'second.example.com:80']);
    expect(parsed.bindExtranet).toBe(true);
    expect(parsed.powerOn).toBe(false);
    expect(parsed.maxMemoryLimit).toBe(4096);
  });

  it('yields an empty array for blank domains', () => {
    expect(projectCreateSchema.parse({...base, domains: ''}).domains).toEqual([]);
  });
});

describe('projectDeleteSchema', () => {
  it('accepts a name and confirm value', () => {
    const parsed = projectDeleteSchema.parse({name: 'myapp', confirm: 'myapp'});
    expect(parsed.name).toBe('myapp');
    expect(parsed.confirm).toBe('myapp');
  });
});
