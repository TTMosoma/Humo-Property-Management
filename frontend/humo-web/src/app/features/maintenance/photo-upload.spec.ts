import { firstValueFrom, of, throwError } from 'rxjs';
import { failedPhotosMessage, uploadAll } from './photo-upload';

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

  it('says each reason once, however many photos it stopped', () => {
    const error = new Error('too large');
    const message = failedPhotosMessage([{ file: file('a.jpg'), error }, { file: file('b.jpg'), error }], 2);
    expect(message.startsWith('None of the 2 photos were stored.')).toBe(true);
    expect(message.split('too large').length).toBeLessThanOrEqual(2);
  });

  it('answers nothing when every photo is stored', async () => {
    expect(await firstValueFrom(uploadAll([file('a.jpg')], () => of(undefined)))).toEqual([]);
  });
});
