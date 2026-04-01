import { Hono } from 'hono'
import { cors } from 'hono/cors'

/**
 * CryptoJS(passphrase) AES 兼容实现，基于 Cloudflare Workers Web Crypto API。
 * 兼容目标：
 * - CryptoJS.AES.encrypt(plaintext, password).toString()
 * - CryptoJS.AES.decrypt(ciphertextB64, password).toString(CryptoJS.enc.Utf8)
 */

const SALTED_PREFIX = new Uint8Array([0x53, 0x61, 0x6c, 0x74, 0x65, 0x64, 0x5f, 0x5f]); // "Salted__"

function concatBytes(...parts) {
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
        out.set(p, offset);
        offset += p.length;
    }
    return out;
}

function bytesEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

function utf8ToBytes(str) { return new TextEncoder().encode(str); }
function bytesToUtf8(bytes) { return new TextDecoder().decode(bytes); }

function base64Encode(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
}

function base64Decode(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function randomBytes(len) {
    const out = new Uint8Array(len);
    crypto.getRandomValues(out);
    return out;
}

/**
 * 核心：异步版 EVP_BytesToKey，使用 Workers 原生 MD5
 */
async function evpBytesToKey(passwordBytes, saltBytes, keyLenBytes, ivLenBytes) {
    const targetLen = keyLenBytes + ivLenBytes;
    let derived = new Uint8Array(0);
    let block = new Uint8Array(0);

    while (derived.length < targetLen) {
        const dataToHash = concatBytes(block, passwordBytes, saltBytes);
        // Cloudflare Workers 特供：支持原生 MD5
        const hashBuffer = await crypto.subtle.digest('MD5', dataToHash);
        block = new Uint8Array(hashBuffer);
        derived = concatBytes(derived, block);
    }

    return {
        key: derived.subarray(0, keyLenBytes),
        iv: derived.subarray(keyLenBytes, keyLenBytes + ivLenBytes)
    };
}

/**
 * 加密 (兼容 CryptoJS.AES.encrypt)
 */
export async function aesEncryptCryptoJSCompat(plaintext, password) {
    const salt = randomBytes(8); // 8字节 Salt
    const { key, iv } = await evpBytesToKey(utf8ToBytes(password), salt, 32, 16);

    const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['encrypt']);
    const pt = utf8ToBytes(plaintext);
    const ctBuf = await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, cryptoKey, pt);
    const ct = new Uint8Array(ctBuf);

    // 组装格式：Salted__ + salt + ciphertext，然后 Base64
    return base64Encode(concatBytes(SALTED_PREFIX, salt, ct));
}

/**
 * 解密 (兼容 CryptoJS.AES.decrypt)
 */
async function aesDecryptCryptoJSCompat(openSslBase64, password) {
    const raw = base64Decode(openSslBase64);
    if (raw.length < 16) throw new Error('密文长度过短');

    const prefix = raw.subarray(0, 8);
    if (!bytesEqual(prefix, SALTED_PREFIX)) {
        throw new Error('仅支持 CryptoJS 默认 OpenSSL 格式（带 Salted__ 前缀）');
    }

    const salt = raw.subarray(8, 16);
    const ciphertext = raw.subarray(16);

    const { key, iv } = await evpBytesToKey(utf8ToBytes(password), salt, 32, 16);
    const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['decrypt']);
    const ptPaddedBuf = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, cryptoKey, ciphertext);

    return bytesToUtf8(new Uint8Array(ptPaddedBuf));
}

const app = new Hono()

app.use('*', cors())

// 全局请求解压与解析中间件
app.use('*', async (c, next) => {
    // 绑定一个按需解析的 parsedBody 方法到请求对象上
    c.req.parsedBody = async () => {
        const contentEncoding = c.req.header('content-encoding')
        let bodyText

        if (contentEncoding && c.req.raw.body) {
            const decompressedStream = c.req.raw.body.pipeThrough(new DecompressionStream(contentEncoding))
            bodyText = await new Response(decompressedStream).text()
        } else {
            bodyText = await c.req.text()
        }

        if (!bodyText) return {}

        const contentType = c.req.header('content-type') || ''
        if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
            return Object.fromEntries(new URLSearchParams(bodyText))
        } else {
            return JSON.parse(bodyText)
        }
    }
    await next()
})

app.all('/', (c) => {
    return c.text('Hello World!')
})

app.post('/update', async (c) => {
    try {
        const body = await c.req.parsedBody().catch(() => ({}))
        const { encrypted, uuid } = body

        if (!encrypted || !uuid) {
            return c.text('Bad Request', 400)
        }

        const content = JSON.stringify({ encrypted })
        await c.env.COOKIE_CLOUD.put(uuid, content)

        return c.json({ action: "done" })
    } catch (err) {
        console.error(err)
        return c.json({ action: "error" })
    }
})

app.all('/get/:uuid', async (c) => {
    const uuid = c.req.param('uuid')
    if (!uuid) {
        return c.text('Bad Request', 400)
    }

    try {
        const dataStr = await c.env.COOKIE_CLOUD.get(uuid)
        if (!dataStr) {
            return c.text('Not Found', 404)
        }

        const data = JSON.parse(dataStr)
        if (!data) {
            return c.text('Internal Serverless Error', 500)
        }

        const body = await c.req.parsedBody().catch(() => ({}))
        const password = body.password

        if (password) {
            const parsed = await cookie_decrypt(uuid, data.encrypted, password)
            return c.json(parsed)
        } else {
            return c.json(data)
        }
    } catch (err) {
        console.error(err)
        return c.text('Internal Serverless Error', 500)
    }
})

app.onError((err, c) => {
    console.error(err)
    return c.text('Internal Serverless Error', 500)
})

export default app

export async function cookie_decrypt(uuid, encrypted, password) {
    // ====== MD5 + Hex substring(0, 16) ======
    const textToHash = uuid + '-' + password;
    const md5Buffer = await crypto.subtle.digest('MD5', new TextEncoder().encode(textToHash));

    // 将 ArrayBuffer 转换为 16 进制字符串（等同于 CryptoJS.MD5(...).toString()）
    const md5Hex = Array.from(new Uint8Array(md5Buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

    // 截取前 16 位
    const the_key = md5Hex.substring(0, 16);

    const decrypted = await aesDecryptCryptoJSCompat(encrypted, the_key);

    return JSON.parse(decrypted);
}
