import { describe, expect, it } from 'vitest';
import { forTool } from './http-session-data-source';

const options = { authenticatorSelection: { residentKey: 'required', userVerification: 'required' } } as unknown as PublicKeyCredentialCreationOptionsJSON;

describe('where a new passkey lives (D30)', () => {
  it('offers the chosen authenticator first and keeps the API’s requirements', () => {
    const phone = forTool(options, 'phone');
    expect(phone.hints).toEqual(['hybrid']);
    expect(phone.authenticatorSelection).toEqual({ residentKey: 'required', userVerification: 'required', authenticatorAttachment: 'cross-platform' });
    expect(forTool(options, 'device').hints).toEqual(['client-device']);
    expect(forTool(options, 'device').authenticatorSelection?.authenticatorAttachment).toBe('platform');
    expect(forTool(options, 'key').hints).toEqual(['security-key']);
  });

  it('leaves everything open for a password manager or the browser’s own list', () => {
    expect(forTool(options, 'manager')).toBe(options);
  });
});
