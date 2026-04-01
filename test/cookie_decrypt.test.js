import { describe, it, expect } from 'vitest';
import { cookie_decrypt, aesEncryptCryptoJSCompat } from '../src/index.js';
import CryptoJS from 'crypto-js';

describe('cookie_decrypt with CryptoJS compatibility', () => {
    const uuid = 'test-uuid-1234';
    const password = 'my-secret-password';
    const originalData = {
        cookies: [{ name: 'session', value: '1234567890' }],
        localStorage: { key: 'value' }
    };
    const plaintext = JSON.stringify(originalData);

    // Get the key the same way CryptoJS does
    const the_key = CryptoJS.MD5(uuid + '-' + password).toString().substring(0, 16);

    it('should successfully decrypt data encrypted with actual CryptoJS', async () => {
        // 1. Encrypt with real CryptoJS
        const encryptedByCryptoJS = CryptoJS.AES.encrypt(plaintext, the_key).toString();

        // 2. Decrypt with our Cloudflare Workers compatible implementation
        const decrypted = await cookie_decrypt(uuid, encryptedByCryptoJS, password);

        // 3. Verify it matches
        expect(decrypted).toEqual(originalData);
    });

    it('actual CryptoJS should successfully decrypt data encrypted with our implementation', async () => {
        // 1. Encrypt with our Cloudflare Workers compatible implementation
        const encryptedByUs = await aesEncryptCryptoJSCompat(plaintext, the_key);

        // 2. Decrypt with real CryptoJS
        const decryptedByCryptoJSStr = CryptoJS.AES.decrypt(encryptedByUs, the_key).toString(CryptoJS.enc.Utf8);
        const decryptedByCryptoJS = JSON.parse(decryptedByCryptoJSStr);

        // 3. Verify it matches
        expect(decryptedByCryptoJS).toEqual(originalData);
    });

    it('should throw an error if given incorrect password', async () => {
        const wrongPassword = 'wrong-password';

        // Encrypt with real CryptoJS using correct password
        const encryptedByCryptoJS = CryptoJS.AES.encrypt(plaintext, the_key).toString();

        // Using wrong password should result in a decryption failure
        await expect(cookie_decrypt(uuid, encryptedByCryptoJS, wrongPassword)).rejects.toThrow();
    });

    it('should throw an error for invalid encrypted format', async () => {
        // Invalid encrypted string (not valid base64 or too short)
        const invalidEncrypted = 'invalid-encrypted-data';

        await expect(cookie_decrypt(uuid, invalidEncrypted, password)).rejects.toThrow();
    });
});
