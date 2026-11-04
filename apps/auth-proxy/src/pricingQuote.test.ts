/**
 * G-001-A (Fases 1–2) — cotação NO SERVIDOR: projeção por perfil (teste ESTRUTURAL), paridade bit-a-bit com o engine,
 * validação estrita, RBAC `pricing.quote`, escopo G-002, rate limit, auditoria sem valores.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { calculate, defaultScenarios, type PricingInput } from '@bondly/pricing-engine';
import { createMemoryRepository } from './memoryRepository.js';
import { handleApi, quoteRateLimiter, type ApiResult } from './api.js';
import { can, ROLES, type Role } from './rbac.js';
import { parsePricingInput } from './quoteInput.js';
import { projectQuote, resolveView, maxViewFor, marginAlertOf, type QuoteViewPayload } from './quoteProjection.js';
import { computeQuote, publicCatalog } from './pricingQuote.js';
import { createRateLimiter } from './rateLimit.js';
import { baseInput, lowMarginInput, parityInputs } from './quoteFixtures.js';
import type { ProposalRepository } from './domain.js';
import type { ServerConfig } from './config.js';
import type { SessionData } from './session.js';

const cfg = { legacyProfileCodes: false, profileCodeHashes: {} } as unknown as ServerConfig;
const E = { biz: 'biz.a@minu.co', biz2: 'biz.b@minu.co', tech: 'tec@minu.co', apr: 'apr@minu.co', adm: 'adm@minu.co', none: 'sem.perfil@minu.co' } as const;
type Who = keyof typeof E;
const ROLE_OF: Partial<Record<Who, Role>> = { biz: 'business', biz2: 'business', tech: 'tech', apr: 'approver', adm: 'admin' };
const sess = (email: string): SessionData => ({ email, domain: 'minu.co', exp: Math.floor(Date.now() / 1000) + 3600 });
const call = (repo: ProposalRepository, who: Who, method: string, path: string, body: unknown = null): Promise<ApiResult> =>
  handleApi({ method, path, session: sess(E[who]), body, repo, cfg });
async function seeded(): Promise<ProposalRepository> {
  const repo = createMemoryRepository();
  for (const w of Object.keys(ROLE_OF) as Who[]) await repo.setAssignment(E[w], ROLE_OF[w]!, 'seed');
  return repo;
}
const quote = (repo: ProposalRepository, who: Who, body: unknown) => call(repo, who, 'POST', '/api/pricing/quote', body);

/** Chaves que NUNCA podem aparecer fora de `internal` (custo/margem/COGS/tributo/premissa de custo/fees Minu/Setup líquido). */
const FORBIDDEN_KEY = /cogs|cost|custo(?!m)|margin|margem|tax|tribut|contribution|conversionfee|accountfee|minu(year|contract|conv|acc)|tcvbondly|setupnet|breakdown|^net|hash|premises(?!version)|floor|target|passthrough|compcomp|totalcomp/i;
const FORBIDDEN_VALUE = /margem|custo(?!m)|cogs|piso de|premissa/i;
/** Única chave "margin*" permitida (somente em commercial): sinal de política SEM valores, validado à parte. */
const ALLOWED_PATH = 'policy.marginAlert';

function findForbidden(node: unknown, path = ''): string[] {
  const hits: string[] = [];
  if (Array.isArray(node)) node.forEach((v, i) => hits.push(...findForbidden(v, `${path}[${i}]`)));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const p = path ? `${path}.${k}` : k;
      if (p === ALLOWED_PATH) {
        const keys = Object.keys(v as object).sort();
        if (JSON.stringify(keys) !== JSON.stringify(['level', 'requiresApproval'])) hits.push(`${p}:shape`);
        continue;
      }
      if (FORBIDDEN_KEY.test(k)) hits.push(p);
      hits.push(...findForbidden(v, p));
    }
  } else if (typeof node === 'string' && FORBIDDEN_VALUE.test(node)) hits.push(`${path}=${node}`);
  return hits;
}

describe('quoteProjection — teste ESTRUTURAL de confidencialidade', () => {
  const inputs = parityInputs();
  for (const view of ['client', 'commercial'] as const) {
    it(`${view}: nenhuma chave/valor de custo, margem, COGS, tributo ou premissa em ${inputs.length} cenários`, () => {
      for (const { name, input } of inputs) {
        const { view: v } = computeQuote(input, view);
        expect(findForbidden(v), `${view}/${name}`).toEqual([]);
      }
    });
  }
  it('o detector é sensível (mutação injetada em client/commercial é pega)', () => {
    const { view: c } = computeQuote(baseInput(), 'client');
    expect(findForbidden({ ...c, costs: { total: 1 } })).toContain('costs');
    expect(findForbidden({ ...c, pricing: { ...(c as { pricing: object }).pricing, technicalMargin: 0.7 } })).toContain('pricing.technicalMargin');
    expect(findForbidden({ ...c, note: 'Margem técnica abaixo do piso de 60%.' }).length).toBeGreaterThan(0);
    expect(findForbidden({ policy: { marginAlert: { level: 'ok', requiresApproval: false, value: 0.7 } } })).toContain('policy.marginAlert:shape');
  });
  it('client não tem política, composição nem Setup detalhado; commercial tem sinal sem valores', () => {
    const c = computeQuote(lowMarginInput(), 'client').view as unknown as Record<string, unknown>;
    expect(Object.keys(c).sort()).toEqual(['contractVersion', 'discounts', 'engineVersion', 'plan', 'premisesVersion', 'pricing', 'scenarios', 'termMonths', 'view']);
    const m = computeQuote(lowMarginInput(), 'commercial').view as unknown as { policy: { marginAlert: unknown } };
    expect(m.policy.marginAlert).toEqual({ level: 'below_floor', requiresApproval: true });
  });
  it('internal expõe o breakdown completo (custo/margem) — só nesta visão', () => {
    const { view } = computeQuote(baseInput(), 'internal');
    expect(findForbidden(view).length).toBeGreaterThan(0);
  });
});

describe('PARIDADE — QuoteView.internal ≡ resultado direto do engine (bit-a-bit)', () => {
  for (const { name, input } of parityInputs()) {
    it(name, () => {
      const direct = calculate(input);
      const q = computeQuote(input, 'internal').view as Extract<QuoteViewPayload, { view: 'internal' }>;
      expect(q.result).toEqual(direct);
      expect(JSON.stringify(q.result)).toBe(JSON.stringify(direct));
      expect(q.scenariosFull).toEqual(defaultScenarios(input).map((s) => ({ name: s.name, result: s.result })));
      // client/commercial derivam do MESMO resultado
      const cl = projectQuote('client', direct, input.negotiation.term, []) as Extract<QuoteViewPayload, { view: 'client' }>;
      expect(cl.pricing.monthly).toBe(direct.core + direct.servicesMrr);
      expect(cl.pricing.setupTotal).toBe(direct.setupClient);
      expect(cl.pricing.firstYearTotal).toBe(direct.clientYear1);
      expect(cl.pricing.tcv).toBe(direct.tcvClient);
      const co = computeQuote(input, 'commercial').view as Extract<QuoteViewPayload, { view: 'commercial' }>;
      expect(co.pricing).toEqual({ ...cl.pricing });
      expect(co.composition.coreMonthly).toBe(direct.core);
      expect(co.waterfall.final).toBe(direct.platformFee);
      expect(co.policy.marginAlert).toEqual(marginAlertOf(direct.marginStatus));
      expect(co.scenarios).toEqual(q.scenarios);
    });
  }
});

describe('validação estrita do PricingInput', () => {
  const bad = (mut: (i: Record<string, any>) => void): ReturnType<typeof parsePricingInput> => {
    const i = JSON.parse(JSON.stringify(baseInput()));
    mut(i);
    return parsePricingInput(i, true);
  };
  it('aceita o input válido', () => expect(parsePricingInput(JSON.parse(JSON.stringify(baseInput())), true).ok).toBe(true));
  it('rejeita NaN, Infinity, negativos, fora de faixa e tipos errados', () => {
    expect(bad((i) => (i.volume.users = Number.NaN))).toMatchObject({ ok: false, field: 'volume.users' });
    expect(bad((i) => (i.volume.users = Infinity))).toMatchObject({ ok: false, field: 'volume.users' });
    expect(bad((i) => (i.volume.users = -1))).toMatchObject({ ok: false, field: 'volume.users' });
    expect(bad((i) => (i.volume.users = 1.5))).toMatchObject({ ok: false, field: 'volume.users' });
    expect(bad((i) => (i.volume.users = 1e12))).toMatchObject({ ok: false, field: 'volume.users' });
    expect(bad((i) => (i.volume.mauPct = 1.2))).toMatchObject({ ok: false, field: 'volume.mauPct' });
    expect(bad((i) => (i.volume.mauPct = '0.4'))).toMatchObject({ ok: false, field: 'volume.mauPct' });
    expect(bad((i) => (i.negotiation.term = 18))).toMatchObject({ ok: false, field: 'negotiation.term' });
    expect(bad((i) => (i.negotiation.option = 'x'))).toMatchObject({ ok: false, field: 'negotiation.option' });
    expect(bad((i) => (i.negotiation.extraDiscount = -0.1))).toMatchObject({ ok: false, field: 'negotiation.extraDiscount' });
    expect(bad((i) => (i.complexity.implementationHours = -5))).toMatchObject({ ok: false, field: 'complexity.implementationHours' });
    expect(bad((i) => (i.communication.strategy = 'pombo'))).toMatchObject({ ok: false, field: 'communication.strategy' });
  });
  it('rejeita chaves desconhecidas, seções ausentes e listas gigantes', () => {
    expect(bad((i) => (i.volume.extra = 1))).toMatchObject({ ok: false, field: 'volume.extra' });
    expect(bad((i) => (i.cogs = { total: 1 }))).toMatchObject({ ok: false, field: 'input.cogs' });
    expect(bad((i) => delete i.services)).toMatchObject({ ok: false, field: 'services' });
    expect(bad((i) => (i.services.profiles = Array.from({ length: 51 }, () => ({}))))).toMatchObject({ ok: false, field: 'services.profiles' });
    expect(parsePricingInput(null, true)).toMatchObject({ ok: false });
    expect(parsePricingInput([], true)).toMatchObject({ ok: false });
  });
  it('modo não-estrito (persistido) ignora chaves extras de topo, mas valida os campos', () => {
    const i = { ...JSON.parse(JSON.stringify(baseInput())), selectedModules: ['points'] };
    expect(parsePricingInput(i, false).ok).toBe(true);
    expect(parsePricingInput(i, true).ok).toBe(false);
  });
});

describe('RBAC pricing.quote — matriz 4 papéis × ação', () => {
  const EXP: Record<Role, boolean> = { business: true, tech: true, approver: true, admin: true };
  for (const r of ROLES) it(`${r} × pricing.quote → ${EXP[r] ? 'permite' : 'nega'}`, () => expect(can(r, 'pricing.quote')).toBe(EXP[r]));
  it('papel indefinido nega; visão máxima = commercial (sem see_internal) | internal (com)', () => {
    expect(can(undefined, 'pricing.quote')).toBe(false);
    expect(maxViewFor('business')).toBe('commercial');
    expect(maxViewFor('approver')).toBe('commercial');
    expect(maxViewFor('tech')).toBe('internal');
    expect(maxViewFor('admin')).toBe('internal');
    expect(resolveView('internal', 'business')).toBeNull();
    expect(resolveView('client', 'business')).toBe('client');
    expect(resolveView(undefined, 'tech')).toBe('internal');
  });
});

describe('POST /api/pricing/quote — API por perfil', () => {
  beforeEach(() => quoteRateLimiter.reset());
  const input = () => JSON.parse(JSON.stringify(baseInput()));

  it('401 sem sessão; 403 sem perfil', async () => {
    const repo = await seeded();
    expect((await handleApi({ method: 'POST', path: '/api/pricing/quote', session: null, body: { input: input() }, repo, cfg })).status).toBe(401);
    expect((await quote(repo, 'none', { input: input() })).status).toBe(403);
  });

  it('cada perfil recebe a visão do seu direito; business/approver NUNCA recebem custo/margem (payload serializado)', async () => {
    const repo = await seeded();
    for (const who of ['biz', 'apr'] as Who[]) {
      const r = await quote(repo, who, { input: lowMarginInput() });
      expect(r.status).toBe(200);
      const q = (r.body as { quote: QuoteViewPayload }).quote;
      expect(q.view).toBe('commercial');
      expect(findForbidden(q)).toEqual([]);
      expect(JSON.stringify(r.body)).not.toMatch(/cogs|technicalMargin|netMargin|costs|taxes|tcvBondly|setupNet|premisesHash/);
      expect((q as { policy: { marginAlert: { requiresApproval: boolean } } }).policy.marginAlert.requiresApproval).toBe(true);
    }
    for (const who of ['tech', 'adm'] as Who[]) {
      const q = ((await quote(repo, who, { input: baseInput() })).body as { quote: QuoteViewPayload }).quote;
      expect(q.view).toBe('internal');
      expect((q as Extract<QuoteViewPayload, { view: 'internal' }>).result).toEqual(calculate(baseInput()));
    }
  });

  it('view=client para qualquer perfil; view=internal para business/approver ⇒ 403 view_forbidden; view inválida ⇒ 400', async () => {
    const repo = await seeded();
    const c = await quote(repo, 'biz', { view: 'client', input: input() });
    expect((c.body as { quote: QuoteViewPayload }).quote.view).toBe('client');
    expect((await quote(repo, 'tech', { view: 'client', input: input() })).status).toBe(200);
    expect(await quote(repo, 'biz', { view: 'internal', input: input() })).toMatchObject({ status: 403, body: { error: 'view_forbidden' } });
    expect(await quote(repo, 'apr', { view: 'internal', input: input() })).toMatchObject({ status: 403 });
    expect((await quote(repo, 'biz', { view: 'god', input: input() })).status).toBe(400);
  });

  it('validação: NaN/negativo/chave extra/versão de contrato/corpo ⇒ 400; corpo grande ⇒ 413', async () => {
    const repo = await seeded();
    const nan = baseInput();
    expect(await quote(repo, 'biz', { input: { ...nan, volume: { ...nan.volume, users: Number.NaN } } })).toMatchObject({ status: 400, body: { error: 'invalid_input', field: 'volume.users' } });
    expect(await quote(repo, 'biz', { input: { ...nan, volume: { ...nan.volume, users: -3 } } })).toMatchObject({ status: 400 });
    expect(await quote(repo, 'biz', { input: input(), isAdmin: true })).toMatchObject({ status: 400, body: { error: 'invalid_body' } });
    expect(await quote(repo, 'biz', { contractVersion: 'quote.v9', input: input() })).toMatchObject({ status: 400, body: { error: 'unsupported_contract_version' } });
    expect((await quote(repo, 'biz', {})).status).toBe(400);
    expect((await quote(repo, 'biz', [1, 2])).status).toBe(400);
    expect((await quote(repo, 'biz', null)).status).toBe(400);
    const huge = input();
    huge.arka.clientName = 'x'.repeat(50);
    huge.pad = 'y'.repeat(40_000);
    expect((await quote(repo, 'biz', { input: huge })).status).toBe(413);
  });

  it('contrato aceito explicitamente (quote.v1) e resposta carrega a versão', async () => {
    const repo = await seeded();
    const r = await quote(repo, 'biz', { contractVersion: 'quote.v1', input: input() });
    expect((r.body as { quote: { contractVersion: string } }).quote.contractVersion).toBe('quote.v1');
  });

  it('G-002: proposalId respeita o guard de dono (alheia/rascunho ⇒ 404); cotação sem proposta é livre', async () => {
    const repo = await seeded();
    const created = await call(repo, 'biz', 'POST', '/api/proposals', { commercial: JSON.parse(JSON.stringify(baseInput())) });
    const id = (created.body as { proposal: { id: string } }).proposal.id;
    expect((await quote(repo, 'biz', { proposalId: id })).status).toBe(200); // dono, inputs persistidos
    expect((await quote(repo, 'biz2', { proposalId: id })).status).toBe(404); // outro business
    expect((await quote(repo, 'apr', { proposalId: id })).status).toBe(404); // rascunho invisível ao aprovador
    expect((await quote(repo, 'tech', { proposalId: id })).status).toBe(404);
    expect((await quote(repo, 'biz2', { input: input() })).status).toBe(200); // sem proposta: livre
    expect((await quote(repo, 'biz', { proposalId: 'x'.repeat(60) })).status).toBe(400);
  });

  it('proposta com inputs incompletos (cliente atual grava {}) ⇒ 422 sem proposalId+input', async () => {
    const repo = await seeded();
    const created = await call(repo, 'biz', 'POST', '/api/proposals', { commercial: {} });
    const id = (created.body as { proposal: { id: string } }).proposal.id;
    expect(await quote(repo, 'biz', { proposalId: id })).toMatchObject({ status: 422, body: { error: 'proposal_inputs_incomplete' } });
    expect((await quote(repo, 'biz', { proposalId: id, input: input() })).status).toBe(200);
  });

  it('rate limit por usuário ⇒ 429 + Retry-After; outro usuário não é afetado', async () => {
    const repo = await seeded();
    const lim = createRateLimiter({ limit: 2, windowMs: 1000, now: () => 0 });
    expect(lim.hit('a').ok && lim.hit('a').ok).toBe(true);
    expect(lim.hit('a')).toMatchObject({ ok: false, retryAfterSec: 1 });
    expect(lim.hit('b').ok).toBe(true);
    // integração: esgota o limiter real (300/min)
    for (let i = 0; i < 300; i++) expect((await quote(repo, 'biz', { input: input() })).status).toBe(200);
    const r = await quote(repo, 'biz', { input: input() });
    expect(r.status).toBe(429);
    expect(r.headers?.['Retry-After']).toMatch(/^\d+$/);
    expect((await quote(repo, 'biz2', { input: input() })).status).toBe(200);
  });

  it('auditoria/log sem valores de preço, input ou e-mail em claro', async () => {
    const repo = await seeded();
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await quote(repo, 'biz', { input: lowMarginInput() });
    const lines = spy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('pricing_quote'));
    spy.mockRestore();
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/biz\.a@|50000|0\.6|monthly|tcv|core|users/);
    expect(JSON.parse(lines[0]!)).toMatchObject({ evt: 'pricing_quote', role: 'business', view: 'commercial' });
  });
});

describe('GET /api/pricing/catalog — só rótulos e limites públicos', () => {
  it('4 perfis acessam; sem perfil 403; sem custo/margem/preço de tabela', async () => {
    const repo = await seeded();
    for (const who of ['biz', 'tech', 'apr', 'adm'] as Who[]) expect((await call(repo, who, 'GET', '/api/pricing/catalog')).status).toBe(200);
    expect((await call(repo, 'none', 'GET', '/api/pricing/catalog')).status).toBe(403);
    const c = publicCatalog();
    expect(c.tierDiscount).toEqual({ min: 0.03, max: 0.07 });
    expect(c.tiers.map((t) => t.name)).toContain('Starter');
    expect(JSON.stringify(c)).not.toMatch(/platformFee|setup|cogs|cost|margin|tax|infra|cleverTap/i);
    expect(findForbidden(c)).toEqual([]);
  });
});

describe('tipos: o servidor não aceita PricingInput como flag de política', () => {
  it('corpo com requiresApproval/margin é recusado (chave desconhecida)', async () => {
    const repo = await seeded();
    const r = await quote(repo, 'biz', { input: baseInput() as PricingInput, requiresApproval: false });
    expect(r.status).toBe(400);
  });
});
