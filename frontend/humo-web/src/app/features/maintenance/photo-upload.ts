import { Observable, catchError, concatMap, from, map, of, toArray } from 'rxjs';
import { describeFailure } from '../../domain';

/** One short sentence for the photos that failed: each reason once, not once per photo. */
export function failedPhotosMessage(failed: { file: File; error: unknown }[], total: number): string {
  const reasons = [...new Set(failed.map((x) => describeFailure(x.error, 'Not stored')))];
  const which = failed.length === total ? (total === 1 ? 'The photo wasn’t' : `None of the ${total} photos were`) : `${failed.length} of ${total} photos weren’t`;
  return `${which} stored. ${reasons.join(' ')}`;
}

/** One at a time, so a large batch doesn't swamp a phone's connection. Answers the ones that failed, with why. */
export function uploadAll(files: File[], upload: (file: File) => Observable<void>): Observable<{ file: File; error: unknown }[]> {
  return from(files).pipe(
    concatMap((file) =>
      upload(file).pipe(
        map(() => null),
        catchError((error: unknown) => of({ file, error })),
      ),
    ),
    toArray(),
    map((results) => results.filter((r): r is { file: File; error: unknown } => r !== null)),
  );
}
