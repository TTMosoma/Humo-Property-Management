import { firstValueFrom, of, throwError } from 'rxjs';
import { ApiError } from '../../domain';
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

  it('gives the reason the API gave, not a pointer to fields a photo doesn’t have', () => {
    const refused = new ApiError('validation', 'Some details need attention', { file: 'Only JPEG, PNG or WebP photos can be uploaded.' });
    expect(failedPhotosMessage([{ file: file('a.jpg'), error: refused }], 1)).toBe('The photo wasn’t stored. Only JPEG, PNG or WebP photos can be uploaded.');
  });

  it('answers nothing when every photo is stored', async () => {
    expect(await firstValueFrom(uploadAll([file('a.jpg')], () => of(undefined)))).toEqual([]);
  });
});
