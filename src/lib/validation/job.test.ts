import {describe, it, expect} from 'vitest';
import {jobListParamsSchema, projectControlJobSchema} from './job';

describe('jobListParamsSchema', () => {
  it('fills in defaults and survives garbage', () => {
    expect(jobListParamsSchema.parse({})).toMatchObject({page: 1, pageSize: 25, status: 'all'});
    expect(jobListParamsSchema.parse({page: 'x', pageSize: [], status: 'melted'})).toMatchObject({
      page: 1,
      pageSize: 25,
      status: 'all',
    });
  });

  it('clamps the page size', () => {
    expect(jobListParamsSchema.parse({pageSize: '1'}).pageSize).toBe(10);
    expect(jobListParamsSchema.parse({pageSize: '5000'}).pageSize).toBe(100);
  });
});

describe('projectControlJobSchema', () => {
  const base = {project: 'api', operation: 'restart', confirm: 'api'};

  it('accepts a matching confirmation and defaults to stopping on error', () => {
    const r = projectControlJobSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.stopOnError).toBe(true);
  });

  // The confirmation is the last thing standing between a typo and fifty restarted
  // production projects.
  it('refuses when the confirmation does not repeat the project name', () => {
    const r = projectControlJobSchema.safeParse({...base, confirm: 'apj'});
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors.confirm).toBeTruthy();
  });

  it('refuses an operation it does not know', () => {
    expect(projectControlJobSchema.safeParse({...base, operation: 'delete'}).success).toBe(false);
  });

  it('reads the stop-on-error switch from a form value', () => {
    const off = projectControlJobSchema.safeParse({...base, stopOnError: 'false'});
    expect(off.success && off.data.stopOnError).toBe(false);
    const on = projectControlJobSchema.safeParse({...base, stopOnError: 'on'});
    expect(on.success && on.data.stopOnError).toBe(true);
  });
});
