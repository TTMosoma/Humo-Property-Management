import { firstValueFrom, of, throwError } from 'rxjs';
import { uploadAll } from './photo-upload';

describe('uploadAll', () => {
  const file = (name: string) => new File(['x'], name, { type: 'image/jpeg' });

  it('uploads each photo in turn and answers the ones that failed', async () => {
    const order: string[] = [];
    const failed = await firstValueFrom(
      uploadAll([file('a.jpg'), file('b.jpg'), file('c.jpg')], (f) => {
        order.push(f.name);
        return f.name === 'b.jpg' ? throwError(() => new Error('too large')) : of(undefined);
      }),
    );

    expect(order).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(failed.map((x) => x.file.name)).toEqual(['b.jpg']);
  });

  it('answers nothing when every photo is stored', async () => {
    expect(await firstValueFrom(uploadAll([file('a.jpg')], () => of(undefined)))).toEqual([]);
  });
});
