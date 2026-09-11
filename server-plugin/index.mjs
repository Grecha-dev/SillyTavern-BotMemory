/**
 * BotMemory — файловая память для персонажей (серверный плагин).
 * Хранилище: <DATA_ROOT>/default-user/botmemory/<персонаж>/<файл>.md
 * Маршруты монтируются лоадером в /api/plugins/botmemory/<op>.
 */

import fs from 'node:fs';
import path from 'node:path';

export const info = {
    id: 'botmemory',
    name: 'BotMemory',
    description: 'File-based per-character memory storage for the BotMemory extension.',
};

const MAX_FILES = 100;
const MAX_FILE_BYTES = 128 * 1024;
const MAX_CONTENT_CHARS = 128 * 1024;
const ONE_LINER_MAX = 140;

function storageRoot() {
    const dataRoot = globalThis.DATA_ROOT ?? path.join(process.cwd(), 'data');
    return path.join(dataRoot, 'default-user', 'botmemory');
}

/** Папка персонажа: пропускаем только безопасные символы, никаких путей. */
function charDir(char) {
    if (typeof char !== 'string' || !char.trim()) return null;
    const clean = char.replace(/[^\p{L}\p{N} _().\-]/gu, '_').slice(0, 80);
    if (!clean || clean.includes('..')) return null;
    return path.join(storageRoot(), clean);
}

/** Имя файла: строго basename.md, без разделителей путей. */
function sanitizeName(name) {
    if (typeof name !== 'string') return null;
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 80) return null;
    if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) return null;
    if (!/^[\p{L}\p{N} _().\-]+\.md$/u.test(trimmed)) return null;
    return trimmed;
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

/** Однострочник для INDEX: первая непустая строка, без markdown-маркеров. */
function extractOneLiner(content) {
    const line = (content || '')
        .split('\n')
        .map(l => l.trim())
        .find(l => l.length > 0) ?? '';
    return line.replace(/^[#>\-*\s]+/, '').slice(0, ONE_LINER_MAX);
}

function listFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter(f => f.endsWith('.md') && fs.statSync(path.join(dir, f)).isFile())
        .map(f => {
            const p = path.join(dir, f);
            const stat = fs.statSync(p);
            let oneLiner = '';
            try {
                oneLiner = extractOneLiner(fs.readFileSync(p, 'utf8'));
            } catch { /* файл на чтении не критичен */ }
            return { name: f, oneLiner, size: stat.size, mtime: stat.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
}

function badRequest(response, message) {
    return response.status(400).json({ ok: false, error: message });
}

/** Секрет из secrets.json: по id записи (uuid) или по имени слота (активная запись). */
function findSecretValue({ secretId, secretKeyId }) {
    try {
        const dataRoot = globalThis.DATA_ROOT ?? path.join(process.cwd(), 'data');
        const secrets = JSON.parse(fs.readFileSync(path.join(dataRoot, 'default-user', 'secrets.json'), 'utf8'));
        if (secretId) {
            for (const arr of Object.values(secrets)) {
                if (!Array.isArray(arr)) continue;
                const hit = arr.find(x => x && x.id === secretId && x.value);
                if (hit) return String(hit.value);
            }
            // легаси: клиент прислал имя слота вместо id записи
            if (/^api_key_/i.test(secretId)) secretKeyId = secretId;
        }
        if (secretKeyId) {
            const arr = Array.isArray(secrets[secretKeyId]) ? secrets[secretKeyId] : [];
            const active = arr.find(x => x && x.active && x.value) ?? arr.find(x => x && x.value);
            return String(active?.value ?? '');
        }
        return '';
    } catch {
        return '';
    }
}

/**
 * @param {import('express').Router} router
 */
export async function init(router) {
    ensureDir(storageRoot());

    router.post('/list', (request, response) => {
        const dir = charDir(request.body?.char);
        if (!dir) return badRequest(response, 'invalid char');
        return response.json({ ok: true, files: listFiles(dir) });
    });

    router.post('/read', (request, response) => {
        const dir = charDir(request.body?.char);
        const name = sanitizeName(request.body?.name);
        if (!dir || !name) return badRequest(response, 'invalid char or name');
        const file = path.join(dir, name);
        if (!fs.existsSync(file)) return response.json({ ok: true, name, content: '', exists: false });
        const content = fs.readFileSync(file, 'utf8');
        return response.json({ ok: true, name, content, exists: true });
    });

    router.post('/write', (request, response) => {
        const dir = charDir(request.body?.char);
        const name = sanitizeName(request.body?.name);
        const content = String(request.body?.content ?? '');
        const append = !!request.body?.append;
        if (!dir || !name) return badRequest(response, 'invalid char or name');
        if (content.length > MAX_CONTENT_CHARS) return badRequest(response, `content too large (>${MAX_CONTENT_CHARS})`);

        ensureDir(dir);
        const file = path.join(dir, name);
        const exists = fs.existsSync(file);

        if (!exists && !append && listFiles(dir).length >= MAX_FILES) {
            return badRequest(response, `too many files (>${MAX_FILES})`);
        }

        if (append && exists) {
            const current = fs.readFileSync(file, 'utf8');
            if (Buffer.byteLength(current, 'utf8') + Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) {
                return badRequest(response, `file too large (>${MAX_FILE_BYTES} bytes)`);
            }
            fs.appendFileSync(file, (current.endsWith('\n') || current === '' ? '' : '\n') + content, 'utf8');
        } else {
            if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) {
                return badRequest(response, `file too large (>${MAX_FILE_BYTES} bytes)`);
            }
            fs.writeFileSync(file, content, 'utf8');
        }

        return response.json({ ok: true, name, appended: append && exists });
    });

    /** Приём клиентских ошибок: UI-расширение складывает сюда стеки (отладка с телефона). */
    router.post('/log', (request, response) => {
        try {
            const dir = storageRoot();
            ensureDir(dir);
            const file = path.join(dir, '_client-errors.log');
            const entry = JSON.stringify({
                ts: new Date().toISOString(),
                where: String(request.body?.where ?? '').slice(0, 200),
                message: String(request.body?.message ?? '').slice(0, 2000),
                stack: String(request.body?.stack ?? '').slice(0, 8000),
            }) + '\n';
            fs.appendFileSync(file, entry, 'utf8');
            // кап: держим хвост файла в пределах 256 КБ
            const stat = fs.statSync(file);
            if (stat.size > 256 * 1024) {
                const content = fs.readFileSync(file, 'utf8');
                fs.writeFileSync(file, content.slice(-128 * 1024), 'utf8');
            }
            return response.json({ ok: true });
        } catch (error) {
            return response.status(500).json({ ok: false, error: String(error) });
        }
    });

    router.post('/delete', (request, response) => {
        const dir = charDir(request.body?.char);
        const name = sanitizeName(request.body?.name);
        if (!dir || !name) return badRequest(response, 'invalid char or name');
        const file = path.join(dir, name);
        if (fs.existsSync(file)) fs.unlinkSync(file);
        return response.json({ ok: true, name });
    });

    // Выжимка через отдельный профиль: сервер сам зовёт OpenAI-совместимый
    // endpoint (ключ берётся из secrets.json — клиент секретов не видит).
    router.post('/consolidate', async (request, response) => {
        try {
            const prompt = String(request.body?.prompt ?? '');
            const system = String(request.body?.system ?? '');
            const baseUrl = String(request.body?.baseUrl ?? '').replace(/\/+$/, '');
            const model = String(request.body?.model ?? '').trim();
            const secretKeyId = String(request.body?.secretKeyId ?? '').trim();
            const maxTokens = Math.min(Math.max(Number(request.body?.maxTokens) || 3000, 256), 32000);

            if (!prompt) return badRequest(response, 'prompt is required');
            if (!/^https?:\/\//.test(baseUrl)) return badRequest(response, 'baseUrl must be http(s)');
            if (!model) return badRequest(response, 'model is required');
            const secretId = String(request.body?.secretId ?? '').trim();
            if (secretKeyId && !/^[a-z0-9_]+$/i.test(secretKeyId)) return badRequest(response, 'invalid secretKeyId');
            if (secretId && !/^[\w-]+$/i.test(secretId)) return badRequest(response, 'invalid secretId');
            if (!secretId && !secretKeyId) return badRequest(response, 'secretId or secretKeyId is required');

            const apiKey = findSecretValue({ secretId, secretKeyId });
            if (!apiKey) return badRequest(response, 'no matching secret found in Secrets');

            const upstream = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({
                    model,
                    messages: [
                        ...(system ? [{ role: 'system', content: system }] : []),
                        { role: 'user', content: prompt },
                    ],
                    max_tokens: maxTokens,
                    stream: false,
                }),
                signal: AbortSignal.timeout(180000),
            });

            const rawBody = await upstream.text();
            let data = null;
            try { data = JSON.parse(rawBody); } catch { /* не JSON — отдадим как текст ошибки */ }
            if (!upstream.ok) {
                const msg = data?.error?.message || rawBody.slice(0, 300) || upstream.statusText;
                return response.status(502).json({ ok: false, error: `upstream ${upstream.status}: ${msg}` });
            }
            const choice = data?.choices?.[0];
            let text = choice?.message?.content ?? '';
            if (Array.isArray(text)) text = text.map(p => p?.text ?? '').join('');
            if (!text) {
                return response.status(502).json({ ok: false, error: `empty completion (finish_reason=${choice?.finish_reason ?? 'unknown'})` });
            }
            return response.json({ ok: true, text });
        } catch (error) {
            return response.status(502).json({ ok: false, error: String(error?.message ?? error) });
        }
    });

    // Список моделей с OpenAI-совместимого endpoint'а (для выпадашки в плашке).
    router.post('/models', async (request, response) => {
        try {
            const baseUrl = String(request.body?.baseUrl ?? '').replace(/\/+$/, '');
            const secretId = String(request.body?.secretId ?? '').trim();
            const secretKeyId = String(request.body?.secretKeyId ?? '').trim();
            if (!/^https?:\/\//.test(baseUrl)) return badRequest(response, 'baseUrl must be http(s)');
            if (secretKeyId && !/^[a-z0-9_]+$/i.test(secretKeyId)) return badRequest(response, 'invalid secretKeyId');
            if (secretId && !/^[\w-]+$/i.test(secretId)) return badRequest(response, 'invalid secretId');
            if (!secretId && !secretKeyId) return badRequest(response, 'secretId or secretKeyId is required');

            const apiKey = findSecretValue({ secretId, secretKeyId });
            if (!apiKey) return badRequest(response, 'no matching secret found in Secrets');

            const upstream = await fetch(`${baseUrl}/models`, {
                headers: { 'Authorization': `Bearer ${apiKey}` },
                signal: AbortSignal.timeout(30000),
            });
            const rawBody = await upstream.text();
            let data = null;
            try { data = JSON.parse(rawBody); } catch { /* не JSON */ }
            if (!upstream.ok) {
                const msg = data?.error?.message || rawBody.slice(0, 300) || upstream.statusText;
                return response.status(502).json({ ok: false, error: `upstream ${upstream.status}: ${msg}` });
            }
            const ids = Array.isArray(data?.data) ? data.data.map(m => m?.id).filter(Boolean).sort() : [];
            return response.json({ ok: true, models: ids });
        } catch (error) {
            return response.status(502).json({ ok: false, error: String(error?.message ?? error) });
        }
    });

    console.log('[botmemory] plugin initialized, storage:', storageRoot());
}

export async function exit() {
    console.log('[botmemory] plugin exit');
}
