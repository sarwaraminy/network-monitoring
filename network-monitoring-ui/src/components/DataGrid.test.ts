import { describe, expect, it } from 'vitest';
import { mergeContainerProps, numericColumn } from './DataGrid';

/**
 * Both of these exist because of a failure mode that is invisible at a glance:
 * a rule that "would look applied and silently not be". That is precisely what
 * needs pinning — nothing about a table rendering correctly tells you the
 * measured height reached it, or that a column kept its tabular figures.
 *
 * `mergeContainerProps` has four paths and `numericColumn` has four more, and no
 * call site currently passes `muiTableContainerProps`, so the merge branch never
 * runs in the app either. These are the only thing exercising it.
 */

const OWN = { maxHeight: '400px' };

describe('mergeContainerProps', () => {
  it('uses ours when the caller passes nothing', () => {
    expect(mergeContainerProps(OWN, undefined)).toEqual({ sx: OWN });
  });

  it('merges the caller over ours, key by key', () => {
    // The naive `{...ours, ...theirs}` drops our `sx` wholesale the moment a
    // caller sets one — which would lose the measured height on exactly the
    // tables that customise anything.
    const merged = mergeContainerProps(OWN, { sx: { minWidth: 320 } });
    expect(merged).toEqual({ sx: { maxHeight: '400px', minWidth: 320 } });
  });

  it('lets the caller win on a key we both set', () => {
    const merged = mergeContainerProps(OWN, { sx: { maxHeight: '10vh' } });
    expect(merged).toEqual({ sx: { maxHeight: '10vh' } });
  });

  it('keeps the caller`s other props alongside the merged sx', () => {
    const merged = mergeContainerProps(OWN, { id: 'scroller', sx: { minWidth: 320 } });
    expect(merged).toMatchObject({ id: 'scroller', sx: { maxHeight: '400px', minWidth: 320 } });
  });

  it('passes a function form straight through', () => {
    // Nothing to merge with statically, so the caller replaces ours.
    const asFunction = () => ({ sx: { maxHeight: '1px' } });
    expect(mergeContainerProps(OWN, asFunction)).toBe(asFunction);
  });

  it('does not try to merge into an array sx', () => {
    const arraySx = [{ minWidth: 320 }];
    expect(mergeContainerProps(OWN, { sx: arraySx })).toEqual({ sx: arraySx });
  });
});

describe('numericColumn', () => {
  it('right-aligns the head and body and adds tabular figures', () => {
    const column = numericColumn({ accessorKey: 'count', header: 'Count' });

    expect(column.muiTableHeadCellProps).toEqual({ align: 'right' });
    expect(column.muiTableBodyCellProps).toEqual({
      align: 'right',
      sx: { fontVariantNumeric: 'tabular-nums' },
    });
  });

  it('keeps the column`s own cell props underneath ours', () => {
    const column = numericColumn({
      accessorKey: 'count',
      header: 'Count',
      muiTableBodyCellProps: { sx: { color: 'red' } },
    });

    expect(column.muiTableBodyCellProps).toEqual({
      align: 'right',
      sx: { fontVariantNumeric: 'tabular-nums', color: 'red' },
    });
  });

  it('leaves a callback form untouched', () => {
    // A column deciding per row is not something this can merge into, and
    // half-applying the alignment would be worse than leaving it alone.
    const asFunction = () => ({ align: 'left' as const });
    const column = numericColumn({
      accessorKey: 'count',
      header: 'Count',
      muiTableHeadCellProps: asFunction,
      muiTableBodyCellProps: asFunction,
    });

    expect(column.muiTableHeadCellProps).toBe(asFunction);
    expect(column.muiTableBodyCellProps).toBe(asFunction);
  });

  it('formats a number with locale grouping when the column has no Cell', () => {
    const column = numericColumn({ accessorKey: 'count', header: 'Count' });
    const render = column.Cell as (props: { cell: { getValue: () => unknown } }) => unknown;

    expect(render({ cell: { getValue: () => 1204 } })).toBe((1204).toLocaleString());
  });

  it('does not replace a Cell the column already defines', () => {
    const own = () => 'mine';
    const column = numericColumn({ accessorKey: 'count', header: 'Count', Cell: own });
    expect(column.Cell).toBe(own);
  });
});
