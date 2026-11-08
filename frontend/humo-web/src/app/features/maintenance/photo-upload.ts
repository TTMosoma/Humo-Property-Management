import { Observable, catchError, concatMap, from, map, of, toArray } from 'rxjs';

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
