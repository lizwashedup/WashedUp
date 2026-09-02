export type JoinErrorSurface = 'inline' | 'alert';

/** Keep failures visible whether the greeting sheet is open or already closed. */
export function joinErrorSurface(joinSheetVisible: boolean): JoinErrorSurface {
  return joinSheetVisible ? 'inline' : 'alert';
}
